namespace EmployeeBehavior.Agent.Service.Logging;

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

        // TODO: When the install pipeline is ready, add EventLog / file sink wiring here.
        return loggingBuilder;
    }
}
