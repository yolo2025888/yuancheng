using System.Text;

namespace EmployeeBehavior.Agent.Service.Logging;

public sealed class PersistentFileLoggerOptions
{
    public bool Enabled { get; set; } = true;

    public string? Path { get; set; }
}

internal sealed class PersistentFileLoggerProvider : ILoggerProvider, ISupportExternalScope
{
    private readonly object _syncRoot = new();
    private readonly string _resolvedPath;
    private readonly PersistentFileLoggerOptions _options;
    private IExternalScopeProvider _scopeProvider = new LoggerExternalScopeProvider();
    private StreamWriter? _writer;
    private bool _disposed;
    private bool _writeFailureReported;

    public PersistentFileLoggerProvider(PersistentFileLoggerOptions options, string defaultFileName)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _resolvedPath = ResolvePath(options.Path, defaultFileName);
    }

    public ILogger CreateLogger(string categoryName)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return new PersistentFileLogger(categoryName, this);
    }

    public void Dispose()
    {
        lock (_syncRoot)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _writer?.Dispose();
            _writer = null;
        }
    }

    public void SetScopeProvider(IExternalScopeProvider scopeProvider)
    {
        _scopeProvider = scopeProvider ?? throw new ArgumentNullException(nameof(scopeProvider));
    }

    internal IDisposable BeginScope<TState>(TState state)
        where TState : notnull
    {
        return _scopeProvider.Push(state);
    }

    internal bool IsEnabled(LogLevel logLevel)
    {
        return _options.Enabled && logLevel != LogLevel.None;
    }

    internal void WriteLog(
        string categoryName,
        LogLevel logLevel,
        EventId eventId,
        string message,
        Exception? exception)
    {
        if (!TryEnsureWriter(out var writer))
        {
            return;
        }

        var entry = FormatEntry(categoryName, logLevel, eventId, message, exception);

        lock (_syncRoot)
        {
            writer.WriteLine(entry);
        }
    }

    private string FormatEntry(
        string categoryName,
        LogLevel logLevel,
        EventId eventId,
        string message,
        Exception? exception)
    {
        var builder = new StringBuilder();
        builder.Append(DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:ss.fff zzz"));
        builder.Append(' ');
        builder.Append('[');
        builder.Append(GetLevelCode(logLevel));
        builder.Append("] ");
        builder.Append(categoryName);

        if (eventId.Id != 0 || !string.IsNullOrWhiteSpace(eventId.Name))
        {
            builder.Append(" (");
            builder.Append(eventId.Id);
            if (!string.IsNullOrWhiteSpace(eventId.Name))
            {
                builder.Append(':');
                builder.Append(eventId.Name);
            }

            builder.Append(')');
        }

        var scopeText = BuildScopeText();
        if (!string.IsNullOrEmpty(scopeText))
        {
            builder.Append(" => ");
            builder.Append(scopeText);
        }

        if (!string.IsNullOrWhiteSpace(message))
        {
            builder.Append(": ");
            builder.Append(message);
        }

        if (exception is not null)
        {
            if (!string.IsNullOrWhiteSpace(message))
            {
                builder.AppendLine();
            }
            else
            {
                builder.Append(": ");
            }

            builder.Append(exception);
        }

        return builder.ToString();
    }

    private string BuildScopeText()
    {
        var scopes = new List<string>();
        _scopeProvider.ForEachScope(static (scope, state) =>
        {
            if (scope is not null)
            {
                state.Add(scope.ToString() ?? scope.GetType().Name);
            }
        }, scopes);

        return scopes.Count == 0
            ? string.Empty
            : string.Join(" => ", scopes);
    }

    private bool TryEnsureWriter(out StreamWriter writer)
    {
        lock (_syncRoot)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);

            if (_writer is not null)
            {
                writer = _writer;
                return true;
            }

            try
            {
                var directoryPath = System.IO.Path.GetDirectoryName(_resolvedPath);
                if (!string.IsNullOrWhiteSpace(directoryPath))
                {
                    Directory.CreateDirectory(directoryPath);
                }

                var stream = new FileStream(
                    _resolvedPath,
                    FileMode.Append,
                    FileAccess.Write,
                    FileShare.ReadWrite);
                _writer = new StreamWriter(stream, new UTF8Encoding(false))
                {
                    AutoFlush = true
                };
                writer = _writer;
                return true;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
            {
                if (!_writeFailureReported)
                {
                    _writeFailureReported = true;
                    Console.Error.WriteLine(
                        $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz} [ERR] File logging disabled for '{_resolvedPath}': {ex.Message}");
                }
            }

            writer = null!;
            return false;
        }
    }

    private static string ResolvePath(string? configuredPath, string defaultFileName)
    {
        var candidatePath = string.IsNullOrWhiteSpace(configuredPath)
            ? System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "EmployeeBehaviorAgent",
                "logs",
                defaultFileName)
            : configuredPath.Trim();

        candidatePath = Environment.ExpandEnvironmentVariables(candidatePath);
        return System.IO.Path.IsPathRooted(candidatePath)
            ? candidatePath
            : System.IO.Path.GetFullPath(candidatePath, AppContext.BaseDirectory);
    }

    private static string GetLevelCode(LogLevel logLevel)
    {
        return logLevel switch
        {
            LogLevel.Trace => "TRC",
            LogLevel.Debug => "DBG",
            LogLevel.Information => "INF",
            LogLevel.Warning => "WRN",
            LogLevel.Error => "ERR",
            LogLevel.Critical => "CRT",
            _ => "NON"
        };
    }
}

internal sealed class PersistentFileLogger : ILogger
{
    private readonly string _categoryName;
    private readonly PersistentFileLoggerProvider _provider;

    public PersistentFileLogger(string categoryName, PersistentFileLoggerProvider provider)
    {
        _categoryName = categoryName;
        _provider = provider;
    }

    public IDisposable BeginScope<TState>(TState state)
        where TState : notnull
    {
        return _provider.BeginScope(state);
    }

    public bool IsEnabled(LogLevel logLevel)
    {
        return _provider.IsEnabled(logLevel);
    }

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        if (!IsEnabled(logLevel))
        {
            return;
        }

        ArgumentNullException.ThrowIfNull(formatter);

        var message = formatter(state, exception);
        if (string.IsNullOrWhiteSpace(message) && exception is null)
        {
            return;
        }

        _provider.WriteLog(_categoryName, logLevel, eventId, message, exception);
    }
}
