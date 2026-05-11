// check-extraction.mongo.js
//
// Verify whether the .NET extractor processed a repository successfully.
// Designed for the LIM-40151 reproducer but works for any repo by name.
//
// Usage (mongosh, connected to the customer's primary database):
//   mongosh "<conn-str>" --file scripts/check-extraction.mongo.js
// or paste the file into an open shell.

(function () {
    const REPO_NAME = "Test-DotNet-Mvc-LIM-40151";

    const FAIL = "✗";
    const PASS = "✓";
    const WARN = "!";

    function line(ch = "=") { print(ch.repeat(64)); }
    function section(title) { print(""); line(); print(title); line(); }

    section(`Probing repository: ${REPO_NAME}`);

    // ---- 1. Repository --------------------------------------------------
    const repo = db.repositories.findOne(
        { Name: REPO_NAME },
        { Name: 1, HttpCloneUrl: 1, MonitorStatus: 1, RelevancyStatus: 1, TipSha: 1, Languages: 1, FirstCycleCompleted: 1 }
    );
    if (!repo) {
        print(`${FAIL} Repository '${REPO_NAME}' not found in db.repositories`);
        print("   The connector hasn't onboarded it yet; nothing else to check.");
        return;
    }
    const repoKey = repo._id;
    print(`${PASS} Repository found`);
    print(`   _id            : ${repoKey}`);
    print(`   HttpCloneUrl   : ${repo.HttpCloneUrl}`);
    print(`   MonitorStatus  : ${repo.MonitorStatus}`);
    print(`   RelevancyStatus: ${repo.RelevancyStatus}`);
    print(`   TipSha         : ${repo.TipSha}`);
    print(`   Languages      : ${JSON.stringify(repo.Languages || [])}`);
    print(`   FirstCycleDone : ${repo.FirstCycleCompleted}`);

    // ---- 2. Profile -----------------------------------------------------
    section("Repository profile");
    const profile = db.repositoryProfiles.findOne(
        { _id: repoKey },
        { Name: 1, HasApis: 1, CalculatedHasApis: 1, HasSensitiveApis: 1, Languages: 1, FirstCycleCompleted: 1 }
    );
    if (!profile) {
        print(`${FAIL} No repositoryProfiles document — extraction never produced a profile.`);
    } else {
        print(`${PASS} Profile present`);
        print(`   HasApis           : ${profile.HasApis}`);
        print(`   CalculatedHasApis : ${profile.CalculatedHasApis}`);
        print(`   HasSensitiveApis  : ${profile.HasSensitiveApis}`);
    }

    // ---- 3. Commits indexed --------------------------------------------
    section("Commits indexed for this repo");
    const commitCount = db.commits.countDocuments({ RepositoryKey: repoKey });
    const latestCommit = db.commits
        .find({ RepositoryKey: repoKey }, { Sha: 1, AuthorIdentityKey: 1, Timestamp: 1, RepositoryKey: 1 })
        .sort({ Timestamp: -1 })
        .limit(1)
        .toArray()[0];
    if (commitCount === 0) {
        print(`${FAIL} No commits indexed.`);
    } else {
        print(`${PASS} ${commitCount} commit(s) indexed`);
        const ts = latestCommit?.Timestamp?.toISOString?.() ?? latestCommit?.Timestamp;
        print(`   Latest: ${latestCommit?.Sha} by ${latestCommit?.AuthorIdentityKey ?? "(no AuthorIdentityKey)"} at ${ts ?? "(no Timestamp)"}`);
    }

    // ---- 4. Inventory breakdown ----------------------------------------
    section("Inventory breakdown by EntityType");
    const inventoryBuckets = db.inventoryElements.aggregate([
        { $match: { ProfileKey: repoKey, ProfileType: "RepositoryProfile" } },
        { $group: { _id: "$EntityType", count: { $sum: 1 } } },
        { $sort: { count: -1 } }
    ]).toArray();
    if (inventoryBuckets.length === 0) {
        print(`${FAIL} No inventoryElements for this profile.`);
        print("   Extraction either failed or hasn't reached the FeaturesCombiner stage yet.");
    } else {
        inventoryBuckets.forEach(b => print(`   ${String(b._id).padEnd(20)} ${b.count}`));
    }

    // ---- 5. List API entries and probe for the reproducer's routes -----
    section("API entries");
    const apiEntries = db.inventoryElements.find(
        { ProfileKey: repoKey, ProfileType: "RepositoryProfile", EntityType: "Api" },
        {
            "DiffableEntity.CodeReference.HttpMethod": 1,
            "DiffableEntity.CodeReference.HttpRoute": 1,
            "DiffableEntity.CodeReference.MethodName": 1,
            "DiffableEntity.CodeReference.ClassName": 1,
            "DiffableEntity.CodeReference.RelativeFilePath": 1
        }
    ).toArray();
    if (apiEntries.length === 0) {
        print(`${FAIL} No API entries in inventory.`);
    } else {
        apiEntries.forEach(e => {
            const ref = e.DiffableEntity?.CodeReference ?? {};
            print(`   ${(ref.ClassName ?? "?")}.${(ref.MethodName ?? "?")}  →  ${(ref.HttpMethod ? ref.HttpMethod + " " : "")}${ref.HttpRoute ?? "(no route)"}  [${ref.RelativeFilePath ?? ""}]`);
        });
    }

    // Specific expected routes (LIM-40151 reproducer)
    section("Expected reproducer routes");
    const expectedRoutes = [
        { route: "Home/Index/{id}",    label: "HomeController.Index via Default route" },
        { route: "Home/Details/{id}",  label: "HomeController.Details via Default route" },
        { route: "items/{id}",         label: "HomeController.Details via DetailsRoute" }
    ];
    expectedRoutes.forEach(r => {
        const hit = db.inventoryElements.findOne(
            { ProfileKey: repoKey, ProfileType: "RepositoryProfile", EntityType: "Api", "DiffableEntity.CodeReference.HttpRoute": r.route },
            { "DiffableEntity.CodeReference.MethodName": 1 }
        );
        if (hit) {
            print(`${PASS} ${r.label.padEnd(45)} '${r.route}' present`);
        } else {
            print(`${FAIL} ${r.label.padEnd(45)} '${r.route}' missing`);
        }
    });

    // ---- 6. Verdict -----------------------------------------------------
    section("Verdict");
    const hasProfile = !!profile;
    const hasCommits = commitCount > 0;
    const hasInventory = inventoryBuckets.length > 0;
    const apiCount = (inventoryBuckets.find(b => b._id === "Api") || {}).count || 0;
    const hasApis = apiCount > 0;
    const expectedRoutesPresent = expectedRoutes.every(r => apiEntries.some(e => e.DiffableEntity?.CodeReference?.HttpRoute === r.route));

    print(`${hasProfile ? PASS : FAIL} Profile exists`);
    print(`${hasCommits ? PASS : FAIL} Commits indexed`);
    print(`${hasInventory ? PASS : FAIL} Inventory populated`);
    print(`${profile?.HasApis ? PASS : FAIL} repositoryProfiles.HasApis = ${profile?.HasApis}`);
    print(`${hasApis ? PASS : FAIL} APIs in inventory (${apiCount})`);
    print(`${expectedRoutesPresent ? PASS : WARN} All ${expectedRoutes.length} expected reproducer routes present`);

    print("");
    if (hasApis && expectedRoutesPresent) {
        print(`${PASS} Extraction succeeded end-to-end. All expected MVC routes were enriched and indexed.`);
    } else if (hasApis && !expectedRoutesPresent) {
        print(`${WARN} APIs are indexed but not all expected reproducer routes are present. Could mean the reproducer code drifted, or the FeaturesCombiner indexed a partial set. Inspect the 'API entries' section above.`);
    } else if (hasInventory && !hasApis) {
        print(`${FAIL} LIM-40151 signature: non-API entities indexed but no APIs — MVC enrichment is broken.`);
    } else if (!hasInventory && hasCommits) {
        print(`${FAIL} Extraction reached the commit-indexing stage but produced no inventory.`);
        print(`   Check 'extract-commit-dotnet-dead-letter' queue and GCP logs for ArgumentNullException at BuildControllerIndexBySolution.`);
    } else {
        print(`${WARN} Inconclusive. Wait for the next extraction cycle and re-run, or check GCP logs by repositoryKey.`);
    }
})();
