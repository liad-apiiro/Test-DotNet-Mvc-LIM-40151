using System.Web;
using System.Web.Mvc;
using System.Web.Routing;

namespace Reproducer
{
    // MVC application class. Detected because the base type literal is one of
    // `System.Web.HttpApplication` / `HttpApplication` (ClassEntity.cs:63).
    // The `routes.MapRoute(...)` call provides the route mapping that the fixed
    // extractor should enrich onto HomeController's action methods.
    public class MvcApplication : System.Web.HttpApplication
    {
        public static void RegisterRoutes(RouteCollection routes)
        {
            routes.MapRoute(
                name: "Default",
                url: "{controller}/{action}/{id}",
                defaults: new { controller = "Home", action = "Index", id = "" }
            );

            routes.MapRoute(
                name: "DetailsRoute",
                url: "items/{id}",
                defaults: new { controller = "Home", action = "Details" }
            );
        }

        protected void Application_Start()
        {
            RegisterRoutes(RouteTable.Routes);
        }
    }
}
