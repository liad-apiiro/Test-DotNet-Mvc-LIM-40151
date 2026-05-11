// Minimal stubs for the netfx ASP.NET MVC types so this project compiles standalone
// without needing a NuGet restore for Microsoft.AspNet.Mvc (which targets netfx and
// wouldn't restore cleanly on a net8.0 SDK project).
//
// The extractor's MVC detection is purely syntactic — it looks at the base-type
// literal (`Controller` / `HttpApplication`) and the `using System.Web.Mvc;`
// directive. These stubs give Roslyn something to bind to so the project loads
// cleanly under MSBuildWorkspace; the syntactic detection in the extractor fires
// regardless of what `Controller` resolves to.
//
// `Controller` is abstract so the extractor doesn't accidentally classify the stub
// itself as an MVC controller (IsMvcControllerClass filters IsAbstract: false).
namespace System.Web
{
    public class HttpApplication { }

    namespace Routing
    {
        public class RouteCollection
        {
            public void MapRoute(string name, string url, object defaults) { }
        }

        public class RouteTable
        {
            public static RouteCollection Routes { get; } = new RouteCollection();
        }
    }

    namespace Mvc
    {
        public abstract class Controller
        {
            public ActionResult Content(string content) => new ActionResult();
        }

        public class ActionResult { }
    }
}
