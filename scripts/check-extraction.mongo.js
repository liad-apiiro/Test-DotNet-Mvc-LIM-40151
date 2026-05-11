// check-extraction.mongo.js
//
// Verify whether the .NET extractor processed a repository successfully.
// Designed for the LIM-40151 reproducer but works for any repo by name.
//
// Usage (mongosh, connected to the customer's primary database):
//   load("scripts/check-extraction.mongo.js")
// or paste this whole file into the shell.

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
        print(`   FirstCycleDone    : ${profile.FirstCycleCompleted}`);
    }

    // ---- 3. Commits indexed --------------------------------------------
    section("Commits indexed for this repo");
    const commitCount = db.commits.countDocuments({ RepositoryKey: repoKey });
    const latestCommit = db.commits
        .find({ RepositoryKey: repoKey }, { Sha: 1, AuthorName: 1, CommitTime: 1 })
        .sort({ CommitTime: -1 })
        .limit(1)
        .toArray()[0];
    if (commitCount === 0) {
        print(`${FAIL} No commits indexed.`);
    } else {
        print(`${PASS} ${commitCount} commit(s) indexed`);
        print(`   Latest: ${latestCommit?.Sha} by ${latestCommit?.AuthorName} at ${latestCommit?.CommitTime?.toISOString?.() ?? latestCommit?.CommitTime}`);
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

    // ---- 5. Probe the reproducer's known entities ----------------------
    section("Reproducer entity probes");
    const probes = [
        { label: "HomeController class", filter: { "DiffableEntity.Name": "HomeController" } },
        { label: "MVC application class", filter: { "DiffableEntity.Name": "MvcApplication" } },
        { label: "InventoryService class (control)", filter: { "DiffableEntity.Name": "InventoryService" } },
        { label: "Action method 'Index'", filter: { "DiffableEntity.MethodName": "Index" } },
        { label: "Action method 'Details'", filter: { "DiffableEntity.MethodName": "Details" } },
        { label: "Any MVC route", filter: { "DiffableEntity.Route": { $regex: "Home|items", $options: "i" } } }
    ];
    probes.forEach(p => {
        const hits = db.inventoryElements.find(
            { ProfileKey: repoKey, ProfileType: "RepositoryProfile", ...p.filter },
            { EntityType: 1, "DiffableEntity.Name": 1, "DiffableEntity.MethodName": 1, "DiffableEntity.Route": 1, "DiffableEntity.FilePath": 1 }
        ).limit(3).toArray();
        if (hits.length === 0) {
            print(`${FAIL} ${p.label.padEnd(34)} not found`);
        } else {
            hits.forEach(h => {
                const tail = h.DiffableEntity?.Route ?? h.DiffableEntity?.MethodName ?? h.DiffableEntity?.Name ?? "";
                const file = h.DiffableEntity?.FilePath ? ` [${h.DiffableEntity.FilePath}]` : "";
                print(`${PASS} ${p.label.padEnd(34)} ${h.EntityType} → ${tail}${file}`);
            });
        }
    });

    // ---- 6. Verdict -----------------------------------------------------
    section("Verdict");
    const hasProfile = !!profile;
    const hasCommits = commitCount > 0;
    const hasInventory = inventoryBuckets.length > 0;
    const apiCount = (inventoryBuckets.find(b => b._id === "Api") || {}).count || 0;
    const hasApisInInventory = apiCount > 0;
    const hasControlItem = db.inventoryElements.countDocuments({
        ProfileKey: repoKey,
        ProfileType: "RepositoryProfile",
        "DiffableEntity.Name": "InventoryService"
    }) > 0;

    print(`${hasProfile ? PASS : FAIL} Profile exists`);
    print(`${hasCommits ? PASS : FAIL} Commits indexed`);
    print(`${hasInventory ? PASS : FAIL} Inventory populated`);
    print(`${hasControlItem ? PASS : WARN} Control item (InventoryService) in inventory`);
    print(`${hasApisInInventory ? PASS : FAIL} APIs in inventory (${apiCount})  ← this is the LIM-40151 signal`);

    print("");
    if (hasApisInInventory && hasControlItem) {
        print(`${PASS} Extraction succeeded end-to-end. MVC enrichment path is healthy.`);
    } else if (hasControlItem && !hasApisInInventory) {
        print(`${FAIL} LIM-40151 signature: non-MVC code indexed but no APIs — MVC enrichment is broken.`);
    } else if (!hasInventory && hasCommits) {
        print(`${FAIL} Extraction reached the commit-indexing stage but produced no inventory.`);
        print(`   Check 'extract-commit-dotnet-dead-letter' queue and GCP logs for ArgumentNullException at BuildControllerIndexBySolution.`);
    } else {
        print(`${WARN} Inconclusive. Wait for the next extraction cycle and re-run, or check GCP logs by repositoryKey.`);
    }
})();
