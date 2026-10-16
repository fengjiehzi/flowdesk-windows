namespace WindowsDynamicIsland.NotificationBridge;

internal sealed class NotificationSession
{
    public bool Enabled { get; private set; }
    private long _version;

    public long Start()
    {
        Enabled = true;
        return ++_version;
    }

    public void Stop()
    {
        Enabled = false;
        ++_version;
    }

    public long Version => _version;
    public bool IsCurrent(long version) => Enabled && version == _version;
}
