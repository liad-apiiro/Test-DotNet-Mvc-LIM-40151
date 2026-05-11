using System.Web.Mvc;

namespace Reproducer.Controllers
{
    // Triggers the bug. Detection criteria (all syntactic, no NuGet restore needed):
    //   1. Class name ends with "Controller".
    //   2. Source file has `using System.Web.Mvc;`.
    //   3. Base type literal is `Controller`.
    // On a buggy extractor, GetSolutionPath(this entity) returns null, and the
    // resulting null GroupBy key blows up ToDictionary in BuildControllerIndexBySolution.
    public class HomeController : Controller
    {
        public ActionResult Index() => Content("Home.Index");

        public ActionResult Details(int id) => Content($"Home.Details({id})");
    }
}
