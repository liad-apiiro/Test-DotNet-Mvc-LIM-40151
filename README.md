# Test-DotNet-Mvc-LIM-40151

Synthetic minimal reproducer for [LIM-40151](https://apiiro.atlassian.net/browse/LIM-40151) — `ArgumentNullException` in the .NET features extractor's `RepositoryDataCollection.BuildControllerIndexBySolution` when parsing any commit that contains an ASP.NET MVC controller.

## What's in this repo

| File | Purpose |
|---|---|
| `Reproducer.sln` | One-project solution; the extractor opens this to discover `Reproducer.csproj`. |
| `src/Reproducer.csproj` | Minimal SDK-style project targeting `net8.0`. No NuGet references — types come from the inline stubs below. |
| `src/_MvcStubs.cs` | Stubs for `System.Web.Mvc.Controller`, `System.Web.HttpApplication`, and the routing types. Lets the project compile under any SDK without needing the netfx `Microsoft.AspNet.Mvc` package. `Controller` is `abstract` so the extractor doesn't mis-classify the stub itself. |
| `src/MvcApplication.cs` | Class extending `System.Web.HttpApplication`. Detected as the MVC application class because its base type literal is `HttpApplication` (or `System.Web.HttpApplication`). Calls `routes.MapRoute(...)` so a working extractor will register routes against the controller. |
| `src/HomeController.cs` | Class named `HomeController` extending `Controller`, with `using System.Web.Mvc;`. **This is the entity that the buggy code returns `null` for in `GetSolutionPath`**, producing the crash. |
| `src/InventoryService.cs` | **Control item.** Plain C# class, no MVC base, no `Controller` suffix. Should be extracted normally by any version of the extractor — confirms the repro isn't crashing the world, only the MVC code path. |

## Why this code reproduces the bug

The .NET features extractor's `RepositoryDataCollection._solutionBySourceFilePath` is keyed by `document.FilePath` (absolute path, registered in [`SourceFilesParser.cs:807`](https://github.com/apiiro/lim/blob/dev/src/Lim.FeaturesExtractor.Dotnet/Parser/SourceFilesParser.cs#L807)). The reader, `GetSolutionPath`, looks up by `classEntity.FilePath`, which `SourceFileEntity` stores as `Path.GetRelativePath(RootDirectory, originalPath)` ([`SourceFileEntity.cs:14`](https://github.com/apiiro/lim/blob/dev/src/Lim.FeaturesExtractor.Dotnet/Parser/Entities/SourceFileEntity.cs#L14)). Keys never match in production, so:

1. `GetSolutionPath(homeController)` returns `null`.
2. `BuildControllerIndexBySolution` does `AllClassEntities.Where(c.MvcControllerName != null).GroupBy(GetSolutionPath)` → produces a single null-keyed group.
3. `.ToDictionary(g => g.Key, …)` rejects the null key → `System.ArgumentNullException`.
4. The handler nacks the commit with `requeue: False`, the message routes to `extract-commit-dotnet-dead-letter`, the TTL expires, and the message cycles back into `extract-commit-dotnet`. Repeats indefinitely.

The MVC detection that lets this code trigger the bug is purely syntactic ([`ClassEntity.cs:199`](https://github.com/apiiro/lim/blob/dev/src/Lim.FeaturesExtractor.Dotnet/Parser/Entities/ClassEntity.cs#L199)):
- name ends with `Controller`,
- source file has `using System.Web.Mvc;`,
- base type literal is `Controller`.

So no NuGet restore is needed — Roslyn parses the syntax, produces error types for the unresolved `System.Web.Mvc.Controller`, and the extractor's syntactic detection fires regardless.

## Why the control item matters

`InventoryService.cs` is a plain class with a method and a property. It exercises the non-MVC code path: `MvcControllerName` is `null`, the `Where(...).GroupBy(...).ToDictionary(...)` chain is empty on this entity, and no null key is produced. A working extractor should still index this class (verify by inspecting the extracted `CodeEntities` output, or via the Apiiro UI inventory page).

Useful for distinguishing "extractor is broken on this repo entirely" from "extractor crashes only on MVC enrichment" — the latter is the LIM-40151 signature.

## Expected behavior per extractor version

| Version | Outcome |
|---|---|
| `≤ 1.10049.3` (pre-#42193) | Extraction succeeds via the old per-solution flow. `InventoryService` indexed. MVC routes enriched. |
| `1.10234.1` through the LIM-40151 fix ship | Extraction crashes with `ArgumentNullException` at `BuildControllerIndexBySolution`. Commit cycles in `extract-commit-dotnet-dead-letter` TTL loop. `InventoryService` not indexed (whole job fails). |
| post-LIM-40151 fix ([apiiro/lim#43663](https://github.com/apiiro/lim/pull/43663)) | Extraction succeeds. `InventoryService` indexed. `HomeController.Index` MVC route enriched as `Home/Index/{id}`. |

## How to use this repo for validation

1. Onboard it to an Apiiro environment running the version under test.
2. Trigger an extraction (push a new commit, or wait for the periodic sync).
3. **Buggy build**: GCP log for `lim-features-extractor-dotnet` shows the stack trace pointing at `BuildControllerIndexBySolution`. Repository profile in the UI is empty or stale; commits accumulate in the DLQ retry loop.
4. **Fixed build**: extraction completes in seconds. Inventory shows `HomeController` with API route `Home/Index/{id}` and `InventoryService` as a regular class.

## Related links

- Production fix PR: [apiiro/lim#43663](https://github.com/apiiro/lim/pull/43663)
- Bug-introducing PR (per-solution MVC grouping): [apiiro/lim#42193](https://github.com/apiiro/lim/pull/42193)
- Roslyn deadlock fix that unmasked the bug for Semperis-style repos: [apiiro/lim#43160](https://github.com/apiiro/lim/pull/43160)
- Ticket: [LIM-40151](https://apiiro.atlassian.net/browse/LIM-40151)
