using EmployeeBehavior.Agent.SessionHelper.App;
using EmployeeBehavior.Agent.SessionHelper.Capture;
using EmployeeBehavior.Agent.SessionHelper.Configuration;
using EmployeeBehavior.Agent.SessionHelper.Monitoring;
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
        builder.Services.AddSingleton<IInputActivityCounter, InputActivityCounterStub>();
        builder.Services.AddSingleton<ISessionStateProvider, SessionStateProviderStub>();
        builder.Services.AddSingleton<ISessionSnapshotCollector, SessionSnapshotCollector>();
        builder.Services.AddSingleton<AgentSessionApplicationContext>();
        builder.Services.AddHostedService<SessionHelperMonitor>();
        builder.Services.AddHostedService<NamedPipeSessionServer>();

        builder.Logging.ClearProviders();
        builder.Logging.AddConfiguration(builder.Configuration.GetSection("Logging"));
        builder.Logging.AddSimpleConsole(options =>
        {
            options.SingleLine = true;
            options.TimestampFormat = "yyyy-MM-dd HH:mm:ss ";
        });

        await using var host = builder.Build();
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
