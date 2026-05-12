using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace EmployeeBehavior.Agent.SessionHelper.Logging;

public static class LoggingBuilderExtensions
{
    public static ILoggingBuilder AddAgentLogging(
        this ILoggingBuilder loggingBuilder,
        IConfiguration configuration)
    {
        loggingBuilder.ClearProviders();
        loggingBuilder.AddConfiguration(configuration.GetSection("Logging"));
        loggingBuilder.AddSimpleConsole(options =>
        {
            options.SingleLine = true;
            options.TimestampFormat = "yyyy-MM-dd HH:mm:ss ";
        });

        var fileOptions = configuration.GetSection("Logging:File").Get<PersistentFileLoggerOptions>()
            ?? new PersistentFileLoggerOptions();
        loggingBuilder.AddProvider(new PersistentFileLoggerProvider(fileOptions, "helper.log"));

        return loggingBuilder;
    }
}
