using EmployeeBehavior.Agent.SessionHelper.App;
using EmployeeBehavior.Agent.SessionHelper.Capture;
using EmployeeBehavior.Agent.SessionHelper.Configuration;
using EmployeeBehavior.Agent.SessionHelper.Logging;
using EmployeeBehavior.Agent.SessionHelper.Monitoring;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace EmployeeBehavior.Agent.SessionHelper;

internal static class Program
{
    [STAThread]
    private static async Task Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);

        builder.Configuration
            .AddJsonFile("appsettings.json", optional: true, reloadOnChange: true)
            .AddJsonFile("appsettings.Development.json", optional: true, reloadOnChange: true)
            .AddEnvironmentVariables("SESSION_HELPER_");

        builder.Services
            .AddOptions<SessionHelperOptions>()
            .Bind(builder.Configuration.GetSection(SessionHelperOptions.SectionName))
            .ValidateOnStart();

        builder.Services.AddSingleton<IScreenshotCapture, WindowsScreenshotCapture>();
        builder.Services.AddSingleton<IForegroundWindowProvider, Win32ForegroundWindowProvider>();
        builder.Services.AddSingleton<Win32InputActivityCounter>();
        builder.Services.AddSingleton<IInputActivityCounter>(serviceProvider => serviceProvider.GetRequiredService<Win32InputActivityCounter>());
        builder.Services.AddHostedService(serviceProvider => serviceProvider.GetRequiredService<Win32InputActivityCounter>());
        builder.Services.AddSingleton<ISessionStateProvider, Win32SessionStateProvider>();
        builder.Services.AddSingleton<ISessionSnapshotCollector, SessionSnapshotCollector>();
        builder.Services.AddSingleton<AgentSessionApplicationContext>();
        builder.Services.AddHostedService<SessionHelperMonitor>();
        builder.Services.AddHostedService<NamedPipeSessionServer>();

        builder.Logging.AddAgentLogging(builder.Configuration);

        using var host = builder.Build();
        await host.StartAsync();

        var options = host.Services.GetRequiredService<IOptions<SessionHelperOptions>>().Value;
        var runInConsole = args.Any(arg => string.Equals(arg, "--console", StringComparison.OrdinalIgnoreCase))
                           || options.RunInConsole;

        if (runInConsole || !options.EnableTrayIcon)
        {
            await host.WaitForShutdownAsync();
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(host.Services.GetRequiredService<AgentSessionApplicationContext>());

        await host.StopAsync();
    }
}
