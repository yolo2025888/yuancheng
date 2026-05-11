using EmployeeBehavior.Agent.Contracts.Models;
using EmployeeBehavior.Agent.Service.Configuration;
using EmployeeBehavior.Agent.Service.Hosting;
using EmployeeBehavior.Agent.Service.Infrastructure;
using EmployeeBehavior.Agent.Service.Logging;
using EmployeeBehavior.Agent.Service.Policy;
using EmployeeBehavior.Agent.Service.Session;
using EmployeeBehavior.Agent.Service.Transport;
using EmployeeBehavior.Agent.Service.Uploads;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddWindowsService(options =>
{
    options.ServiceName = "EmployeeBehavior.Agent.Service";
});

builder.Configuration
    .AddJsonFile("appsettings.json", optional: true, reloadOnChange: true)
    .AddJsonFile("appsettings.Development.json", optional: true, reloadOnChange: true)
    .AddEnvironmentVariables("AGENT_");

builder.Services
    .AddOptions<AgentServiceOptions>()
    .Bind(builder.Configuration.GetSection(AgentServiceOptions.SectionName))
    .ValidateOnStart();

builder.Services.AddSingleton<IDeviceIdentityStore, FileDeviceIdentityStore>();
builder.Services.AddSingleton<IPolicyCache, InMemoryPolicyCache>();
builder.Services.AddSingleton<IUploadQueue, FileBackedUploadQueue>();
builder.Services.AddSingleton<ISessionHelperClient, NamedPipeSessionHelperClient>();
builder.Services.AddHttpClient<IAgentApiClient, AgentApiClient>((serviceProvider, httpClient) =>
{
    var options = serviceProvider
        .GetRequiredService<Microsoft.Extensions.Options.IOptions<AgentServiceOptions>>()
        .Value;

    if (Uri.TryCreate(options.ApiBaseUrl, UriKind.Absolute, out var baseAddress))
    {
        httpClient.BaseAddress = baseAddress;
    }

});

builder.Services.AddHostedService<AgentWorker>();
builder.Logging.AddAgentLogging(builder.Configuration);

var host = builder.Build();

var policyCache = host.Services.GetRequiredService<IPolicyCache>();
var options = host.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<AgentServiceOptions>>().Value;
policyCache.Update(options.DefaultPolicy ?? AgentPolicy.CreateDefault());

await host.RunAsync();
