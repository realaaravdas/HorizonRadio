using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace HorizonRadio
{
    public class Program
    {
        [STAThread]
        public static void Main(string[] args)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool headlessTest = false;
            foreach (string a in args)
            {
                if (a == "--headless-test") headlessTest = true;
            }

            // Terminate any previous stale background instance of HorizonRadio holding port 8080
            try
            {
                int currentPid = Process.GetCurrentProcess().Id;
                foreach (Process p in Process.GetProcessesByName("HorizonRadio"))
                {
                    if (p.Id != currentPid)
                    {
                        try { p.Kill(); p.WaitForExit(1500); } catch { }
                    }
                }
            }
            catch { }

            using (HorizonStudioServer server = new HorizonStudioServer(8080))
            {
                server.Start();
                if (headlessTest)
                {
                    Thread.Sleep(2500);
                    return;
                }
                Application.Run(new HorizonLauncherForm(server));
            }
        }
    }

    public class HorizonLauncherForm : Form
    {
        private readonly HorizonStudioServer _server;
        private TextBox _txtNimKey;
        private TextBox _txtLocalFolder;
        private Label _lblStatus;
        private NotifyIcon _trayIcon;

        public HorizonLauncherForm(HorizonStudioServer server)
        {
            _server = server;
            Text = "Horizon Pulse 104.7 FM — Desktop Studio (.EXE)";
            Size = new Size(560, 390);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.FromArgb(11, 13, 24);
            ForeColor = Color.FromArgb(245, 247, 255);
            Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            BuildGui();
            LoadConfigIntoFields();

            Shown += (s, e) => OpenStudioAppWindow();
        }

        private void BuildGui()
        {
            Panel header = new Panel
            {
                Dock = DockStyle.Top,
                Height = 68,
                BackColor = Color.FromArgb(20, 14, 36)
            };
            header.Paint += (s, e) =>
            {
                using (LinearGradientBrush brush = new LinearGradientBrush(
                    header.ClientRectangle,
                    Color.FromArgb(255, 31, 143),
                    Color.FromArgb(0, 229, 255),
                    LinearGradientMode.Horizontal))
                {
                    e.Graphics.FillRectangle(brush, 0, header.Height - 3, header.Width, 3);
                }
            };

            Label lblTitle = new Label
            {
                Text = "HORIZON PULSE 104.7 FM",
                Font = new Font("Segoe UI", 15f, FontStyle.Bold),
                ForeColor = Color.FromArgb(255, 65, 160),
                Location = new Point(20, 12),
                AutoSize = true
            };

            Label lblSub = new Label
            {
                Text = "HOSTED BY AMY SIMPSON • ENERGETIC NEURAL VOICE & SPOTIFY MIXER",
                Font = new Font("Segoe UI", 8f, FontStyle.Bold),
                ForeColor = Color.FromArgb(0, 229, 255),
                Location = new Point(22, 41),
                AutoSize = true
            };

            header.Controls.Add(lblTitle);
            header.Controls.Add(lblSub);
            Controls.Add(header);

            _lblStatus = new Label
            {
                Text = "● Studio Server Running on http://127.0.0.1:8080 (Secrets stored in .env)",
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                ForeColor = Color.FromArgb(0, 245, 212),
                Location = new Point(22, 82),
                AutoSize = true
            };
            Controls.Add(_lblStatus);

            Label lblNim = new Label
            {
                Text = "NVIDIA NIM API Key (Saved to git-ignored .env, never config.json):",
                Location = new Point(22, 114),
                AutoSize = true,
                ForeColor = Color.FromArgb(180, 192, 225)
            };
            Controls.Add(lblNim);

            _txtNimKey = new TextBox
            {
                Location = new Point(22, 138),
                Width = 385,
                BackColor = Color.FromArgb(22, 27, 48),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle,
                UseSystemPasswordChar = true
            };
            Controls.Add(_txtNimKey);

            Button btnSaveNim = new Button
            {
                Text = "Save to .env",
                Location = new Point(416, 136),
                Size = new Size(105, 27),
                BackColor = Color.FromArgb(118, 185, 0),
                ForeColor = Color.Black,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnSaveNim.FlatAppearance.BorderSize = 0;
            btnSaveNim.Click += (s, e) =>
            {
                SaveConfigFromFields();
                MessageBox.Show(
                    "NVIDIA NIM API Key saved securely to .env (ignored by Git)!\nconfig.json remains completely free of API keys.",
                    "Horizon Pulse 104.7",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            };
            Controls.Add(btnSaveNim);

            Label lblFolder = new Label
            {
                Text = "Default Local Music Folder (Optional):",
                Location = new Point(22, 178),
                AutoSize = true,
                ForeColor = Color.FromArgb(180, 192, 225)
            };
            Controls.Add(lblFolder);

            _txtLocalFolder = new TextBox
            {
                Location = new Point(22, 202),
                Width = 385,
                BackColor = Color.FromArgb(22, 27, 48),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle
            };
            Controls.Add(_txtLocalFolder);

            Button btnBrowse = new Button
            {
                Text = "Browse...",
                Location = new Point(416, 200),
                Size = new Size(105, 27),
                BackColor = Color.FromArgb(0, 168, 215),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnBrowse.FlatAppearance.BorderSize = 0;
            btnBrowse.Click += (s, e) =>
            {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.Description = "Select a Local Music Folder for Horizon Pulse Radio";
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        _txtLocalFolder.Text = fbd.SelectedPath;
                        SaveConfigFromFields();
                    }
                }
            };
            Controls.Add(btnBrowse);

            Button btnOpenDeck = new Button
            {
                Text = "▶ OPEN HORIZON PULSE STUDIO DECK (GUI + VISUALIZER)",
                Location = new Point(22, 252),
                Size = new Size(500, 46),
                BackColor = Color.FromArgb(255, 31, 143),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnOpenDeck.FlatAppearance.BorderSize = 0;
            btnOpenDeck.Click += (s, e) => OpenStudioAppWindow();
            Controls.Add(btnOpenDeck);

            Label lblHint = new Label
            {
                Text = "Keep this window open (or minimized) while listening. Closing exits the radio server.",
                Location = new Point(22, 312),
                AutoSize = true,
                Font = new Font("Segoe UI", 8f, FontStyle.Italic),
                ForeColor = Color.FromArgb(135, 145, 175)
            };
            Controls.Add(lblHint);

            _trayIcon = new NotifyIcon
            {
                Text = "Horizon Pulse 104.7 FM",
                Icon = SystemIcons.Application,
                Visible = true
            };
            _trayIcon.DoubleClick += (s, e) =>
            {
                Show();
                WindowState = FormWindowState.Normal;
                OpenStudioAppWindow();
            };

            FormClosing += (s, e) =>
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
            };
        }

        private void LoadConfigIntoFields()
        {
            Dictionary<string, object> cfg = _server.ReadMergedConfigAndEnv();
            if (cfg.ContainsKey("nvidiaNimApiKey") && cfg["nvidiaNimApiKey"] != null)
            {
                _txtNimKey.Text = cfg["nvidiaNimApiKey"].ToString();
            }
            if (cfg.ContainsKey("defaultLocalFolder") && cfg["defaultLocalFolder"] != null)
            {
                _txtLocalFolder.Text = cfg["defaultLocalFolder"].ToString();
            }
        }

        private void SaveConfigFromFields()
        {
            Dictionary<string, object> patch = new Dictionary<string, object>();
            patch["nvidiaNimApiKey"] = _txtNimKey.Text.Trim();
            patch["defaultLocalFolder"] = _txtLocalFolder.Text.Trim();
            _server.UpdateConfigAndEnv(patch);
        }

        public void OpenStudioAppWindow()
        {
            string url = "http://127.0.0.1:8080";
            string[] edgeCandidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe")
            };

            foreach (string ep in edgeCandidates)
            {
                if (File.Exists(ep))
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = ep,
                            Arguments = "--app=" + url + " --window-size=1440,920",
                            UseShellExecute = true
                        });
                        return;
                    }
                    catch { }
                }
            }

            try
            {
                Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
            }
            catch { }
        }
    }

    public class HorizonStudioServer : IDisposable
    {
        private readonly int _port;
        private readonly string _rootDir;
        private readonly string _publicDir;
        private readonly string _configPath;
        private readonly string _envPath;
        private readonly HttpListener _listener;
        private readonly JavaScriptSerializer _json;
        private Thread _serverThread;
        private volatile bool _running;

        private static readonly HashSet<string> SecretConfigKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "nvidiaNimApiKey", "rivaApiKey", "llmApiKey", "spotifyClientId", "elevenApiKey"
        };

        private static readonly HashSet<string> AudioExts = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".opus", ".webm"
        };

        private static readonly Dictionary<string, string> MimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" },
            { ".css",  "text/css; charset=utf-8" },
            { ".js",   "application/javascript; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" },
            { ".svg",  "image/svg+xml" },
            { ".png",  "image/png" },
            { ".jpg",  "image/jpeg" },
            { ".mp3",  "audio/mpeg" },
            { ".wav",  "audio/wav" },
            { ".ogg",  "audio/ogg" },
            { ".flac", "audio/flac" },
            { ".m4a",  "audio/mp4" }
        };

        public HorizonStudioServer(int port)
        {
            _port = port;
            _rootDir = AppDomain.CurrentDomain.BaseDirectory;
            _publicDir = Path.Combine(_rootDir, "public");
            _configPath = Path.Combine(_rootDir, "config.json");
            _envPath = Path.Combine(_rootDir, ".env");
            _json = new JavaScriptSerializer { MaxJsonLength = 50 * 1024 * 1024 };
            _listener = new HttpListener();
            _listener.Prefixes.Add("http://127.0.0.1:" + _port + "/");
            _listener.Prefixes.Add("http://localhost:" + _port + "/");
        }

        private JavaScriptSerializer CreateJson()
        {
            return new JavaScriptSerializer { MaxJsonLength = 50 * 1024 * 1024 };
        }

        public void Start()
        {
            _running = true;
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try
                {
                    _listener.Start();
                    break;
                }
                catch
                {
                    Thread.Sleep(300);
                }
            }
            if (_listener.IsListening)
            {
                _serverThread = new Thread(ListenLoop) { IsBackground = true };
                _serverThread.Start();
            }
        }

        private void ListenLoop()
        {
            while (_running && _listener.IsListening)
            {
                try
                {
                    HttpListenerContext ctx = _listener.GetContext();
                    ThreadPool.QueueUserWorkItem(_ => HandleRequest(ctx));
                }
                catch
                {
                    if (!_running) break;
                }
            }
        }

        public Dictionary<string, string> ReadEnv()
        {
            var env = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                if (File.Exists(_envPath))
                {
                    foreach (string rawLine in File.ReadAllLines(_envPath, Encoding.UTF8))
                    {
                        string line = rawLine.Trim();
                        if (string.IsNullOrEmpty(line) || line.StartsWith("#")) continue;
                        int eq = line.IndexOf('=');
                        if (eq > 0)
                        {
                            string k = line.Substring(0, eq).Trim();
                            string v = line.Substring(eq + 1).Trim().Trim('"', '\'');
                            env[k] = v;
                        }
                    }
                }
            }
            catch { }
            return env;
        }

        public void WriteEnv(Dictionary<string, string> env)
        {
            try
            {
                StringBuilder sb = new StringBuilder();
                sb.AppendLine("# Horizon Pulse Radio - Local Secrets (.env)");
                sb.AppendLine("# This file is ignored by Git (.gitignore) and will NEVER be committed to GitHub.");
                sb.AppendLine();
                sb.AppendLine("NVIDIA_NIM_API_KEY=" + (env.ContainsKey("NVIDIA_NIM_API_KEY") ? env["NVIDIA_NIM_API_KEY"] : ""));
                sb.AppendLine("SPOTIFY_CLIENT_ID=" + (env.ContainsKey("SPOTIFY_CLIENT_ID") ? env["SPOTIFY_CLIENT_ID"] : ""));
                sb.AppendLine("ELEVENLABS_API_KEY=" + (env.ContainsKey("ELEVENLABS_API_KEY") ? env["ELEVENLABS_API_KEY"] : ""));
                foreach (var kv in env)
                {
                    if (kv.Key != "NVIDIA_NIM_API_KEY" && kv.Key != "SPOTIFY_CLIENT_ID" && kv.Key != "ELEVENLABS_API_KEY")
                    {
                        sb.AppendLine(kv.Key + "=" + kv.Value);
                    }
                }
                File.WriteAllText(_envPath, sb.ToString(), Encoding.UTF8);
            }
            catch { }
        }

        public Dictionary<string, object> ReadConfigOnly()
        {
            try
            {
                if (File.Exists(_configPath))
                {
                    string raw = File.ReadAllText(_configPath, Encoding.UTF8);
                    var dict = _json.Deserialize<Dictionary<string, object>>(raw);
                    if (dict != null)
                    {
                        foreach (string sKey in SecretConfigKeys)
                        {
                            dict.Remove(sKey);
                        }
                        return dict;
                    }
                }
            }
            catch { }
            return new Dictionary<string, object>();
        }

        public Dictionary<string, object> ReadMergedConfigAndEnv()
        {
            var cfg = ReadConfigOnly();
            var env = ReadEnv();
            cfg["nvidiaNimApiKey"] = env.ContainsKey("NVIDIA_NIM_API_KEY") ? env["NVIDIA_NIM_API_KEY"] : "";
            cfg["spotifyClientId"] = env.ContainsKey("SPOTIFY_CLIENT_ID") ? env["SPOTIFY_CLIENT_ID"] : "";
            cfg["elevenApiKey"] = env.ContainsKey("ELEVENLABS_API_KEY") ? env["ELEVENLABS_API_KEY"] : "";
            return cfg;
        }

        public Dictionary<string, object> UpdateConfigAndEnv(Dictionary<string, object> patch)
        {
            Dictionary<string, object> currentConfig = ReadConfigOnly();
            Dictionary<string, string> currentEnv = ReadEnv();

            if (patch != null)
            {
                foreach (var kv in patch)
                {
                    string k = kv.Key;
                    string valStr = kv.Value != null ? kv.Value.ToString().Trim() : "";

                    if (string.Equals(k, "nvidiaNimApiKey", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(k, "rivaApiKey", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(k, "llmApiKey", StringComparison.OrdinalIgnoreCase))
                    {
                        currentEnv["NVIDIA_NIM_API_KEY"] = valStr;
                    }
                    else if (string.Equals(k, "spotifyClientId", StringComparison.OrdinalIgnoreCase))
                    {
                        currentEnv["SPOTIFY_CLIENT_ID"] = valStr;
                    }
                    else if (string.Equals(k, "elevenApiKey", StringComparison.OrdinalIgnoreCase))
                    {
                        currentEnv["ELEVENLABS_API_KEY"] = valStr;
                    }
                    else if (!SecretConfigKeys.Contains(k))
                    {
                        currentConfig[k] = kv.Value;
                    }
                }
            }

            WriteEnv(currentEnv);
            try
            {
                File.WriteAllText(_configPath, _json.Serialize(currentConfig), Encoding.UTF8);
            }
            catch { }

            return ReadMergedConfigAndEnv();
        }

        private void SendJson(HttpListenerResponse res, object obj, int status = 200)
        {
            res.StatusCode = status;
            res.ContentType = "application/json; charset=utf-8";
            res.AddHeader("Access-Control-Allow-Origin", "*");
            byte[] bytes = Encoding.UTF8.GetBytes(CreateJson().Serialize(obj));
            res.ContentLength64 = bytes.Length;
            res.OutputStream.Write(bytes, 0, bytes.Length);
            res.Close();
        }

        private Dictionary<string, object> ReadJsonBody(HttpListenerRequest req)
        {
            using (StreamReader sr = new StreamReader(req.InputStream, Encoding.UTF8))
            {
                string body = sr.ReadToEnd();
                if (string.IsNullOrWhiteSpace(body)) return new Dictionary<string, object>();
                return CreateJson().Deserialize<Dictionary<string, object>>(body) ?? new Dictionary<string, object>();
            }
        }

        private string GetStr(Dictionary<string, object> d, string key, string def = "")
        {
            if (d != null && d.ContainsKey(key) && d[key] != null)
                return d[key].ToString();
            return def;
        }

        private void HandleRequest(HttpListenerContext ctx)
        {
            HttpListenerRequest req = ctx.Request;
            HttpListenerResponse res = ctx.Response;
            string path = req.Url.AbsolutePath;

            try
            {
                if (req.HttpMethod == "OPTIONS")
                {
                    res.StatusCode = 204;
                    res.AddHeader("Access-Control-Allow-Origin", "*");
                    res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                    res.AddHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
                    res.Close();
                    return;
                }

                if (path == "/api/health")
                {
                    SendJson(res, new Dictionary<string, object>
                    {
                        { "ok", true },
                        { "backend", "native-exe" },
                        { "riva_grpc_available", false }
                    });
                    return;
                }

                if (path == "/api/config")
                {
                    if (req.HttpMethod == "POST")
                    {
                        var patch = ReadJsonBody(req);
                        var updated = UpdateConfigAndEnv(patch);
                        SendJson(res, new Dictionary<string, object> { { "ok", true }, { "config", updated } });
                        return;
                    }
                    SendJson(res, ReadMergedConfigAndEnv());
                    return;
                }

                if (path == "/api/spotify/playlist-public")
                {
                    string pid = req.QueryString["id"];
                    string kind = req.QueryString["kind"];
                    if (string.IsNullOrWhiteSpace(kind)) kind = "playlist";
                    if (string.IsNullOrWhiteSpace(pid))
                    {
                        SendJson(res, new Dictionary<string, object> { { "error", "Missing Spotify ID" } }, 400);
                        return;
                    }
                    HandleSpotifyPublicPlaylist(res, pid.Trim(), kind.Trim());
                    return;
                }

                if (path == "/api/spotify/resolve-audio")
                {
                    string artist = req.QueryString["artist"] ?? "";
                    string title = req.QueryString["title"] ?? "";
                    string preview = req.QueryString["preview"] ?? "";
                    HandleSpotifyResolveAudio(res, artist, title, preview);
                    return;
                }

                if (path == "/api/local/scan" && req.HttpMethod == "POST")
                {
                    var body = ReadJsonBody(req);
                    string targetPath = GetStr(body, "path").Trim().Trim('"', '\'');
                    HandleLocalScan(res, targetPath);
                    return;
                }

                if (path == "/api/local/stream")
                {
                    string fPath = req.QueryString["path"];
                    if (string.IsNullOrWhiteSpace(fPath) || !File.Exists(fPath))
                    {
                        SendJson(res, new Dictionary<string, object> { { "error", "Audio file not found" } }, 404);
                        return;
                    }
                    ServeFile(res, fPath);
                    return;
                }

                if (path == "/api/llm/generate" && req.HttpMethod == "POST")
                {
                    var payload = ReadJsonBody(req);
                    HandleLlmProxy(res, payload);
                    return;
                }

                if (path == "/api/tts/riva" && req.HttpMethod == "POST")
                {
                    var payload = ReadJsonBody(req);
                    HandleRivaTtsProxy(res, payload);
                    return;
                }

                if (path == "/" || path == "/callback") path = "/index.html";
                string rel = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                string fullPath = Path.Combine(_publicDir, rel);
                if (File.Exists(fullPath))
                {
                    ServeFile(res, fullPath);
                }
                else
                {
                    res.StatusCode = 404;
                    res.Close();
                }
            }
            catch (Exception ex)
            {
                try
                {
                    SendJson(res, new Dictionary<string, object> { { "error", ex.Message } }, 500);
                }
                catch { }
            }
        }

        private void ServeFile(HttpListenerResponse res, string fullPath)
        {
            string ext = Path.GetExtension(fullPath);
            string mime;
            if (!MimeTypes.TryGetValue(ext, out mime)) mime = "application/octet-stream";
            res.ContentType = mime;
            res.AddHeader("Access-Control-Allow-Origin", "*");
            byte[] bytes = File.ReadAllBytes(fullPath);
            res.ContentLength64 = bytes.Length;
            res.OutputStream.Write(bytes, 0, bytes.Length);
            res.Close();
        }

        private void HandleSpotifyPublicPlaylist(HttpListenerResponse res, string itemId, string kind)
        {
            string url = "https://open.spotify.com/embed/" + kind + "/" + itemId;
            HttpWebRequest wr = (HttpWebRequest)WebRequest.Create(url);
            wr.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
            wr.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            wr.Timeout = 15000;

            using (HttpWebResponse resp = (HttpWebResponse)wr.GetResponse())
            using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            {
                string html = sr.ReadToEnd();
                Match m = Regex.Match(html, @"<script id=""__NEXT_DATA__"" type=""application/json"">(.*?)</script>", RegexOptions.Singleline);
                if (!m.Success)
                {
                    SendJson(res, new Dictionary<string, object> { { "error", "Could not parse Spotify embed data" } }, 502);
                    return;
                }

                var root = CreateJson().Deserialize<Dictionary<string, object>>(m.Groups[1].Value);
                var props = root["props"] as Dictionary<string, object>;
                var pageProps = props["pageProps"] as Dictionary<string, object>;
                var state = pageProps["state"] as Dictionary<string, object>;
                var data = state["data"] as Dictionary<string, object>;
                var entity = data["entity"] as Dictionary<string, object>;

                string pName = GetStr(entity, "name", GetStr(entity, "title", "Spotify Playlist"));
                string coverUrl = "";
                if (entity.ContainsKey("coverArt") && entity["coverArt"] is Dictionary<string, object>)
                {
                    var ca = entity["coverArt"] as Dictionary<string, object>;
                    if (ca.ContainsKey("sources") && ca["sources"] is System.Collections.ArrayList)
                    {
                        var sources = ca["sources"] as System.Collections.ArrayList;
                        if (sources.Count > 0 && sources[0] is Dictionary<string, object>)
                        {
                            coverUrl = GetStr(sources[0] as Dictionary<string, object>, "url");
                        }
                    }
                }
                else if (entity.ContainsKey("visualIdentity") && entity["visualIdentity"] is Dictionary<string, object>)
                {
                    var vi = entity["visualIdentity"] as Dictionary<string, object>;
                    if (vi.ContainsKey("image") && vi["image"] is System.Collections.ArrayList)
                    {
                        var imgs = vi["image"] as System.Collections.ArrayList;
                        if (imgs.Count > 0 && imgs[0] is Dictionary<string, object>)
                        {
                            coverUrl = GetStr(imgs[0] as Dictionary<string, object>, "url");
                        }
                    }
                }

                var trackListOut = new List<Dictionary<string, object>>();
                if (entity.ContainsKey("trackList") && entity["trackList"] is System.Collections.ArrayList)
                {
                    var rawList = entity["trackList"] as System.Collections.ArrayList;
                    int idx = 0;
                    foreach (object itemObj in rawList)
                    {
                        var item = itemObj as Dictionary<string, object>;
                        if (item == null) continue;
                        string uri = GetStr(item, "uri");
                        string[] parts = uri.Split(':');
                        string tid = parts.Length > 0 ? parts[parts.Length - 1] : ("sp-" + idx);
                        string prevUrl = "";
                        if (item.ContainsKey("audioPreview") && item["audioPreview"] is Dictionary<string, object>)
                        {
                            prevUrl = GetStr(item["audioPreview"] as Dictionary<string, object>, "url");
                        }
                        int dur = 200000;
                        if (item.ContainsKey("duration") && item["duration"] != null)
                        {
                            int.TryParse(item["duration"].ToString(), out dur);
                        }

                        trackListOut.Add(new Dictionary<string, object>
                        {
                            { "id", tid },
                            { "uri", uri },
                            { "title", GetStr(item, "title", "Unknown Track") },
                            { "artist", GetStr(item, "subtitle", "Unknown Artist").Replace("\u00a0", " ") },
                            { "album", pName },
                            { "duration_ms", dur },
                            { "preview_url", prevUrl },
                            { "cover_url", coverUrl },
                            { "source", "spotify" }
                        });
                        idx++;
                    }
                }
                else if (kind == "track")
                {
                    // Single Spotify track embed
                    string prevUrl = "";
                    if (entity.ContainsKey("audioPreview") && entity["audioPreview"] is Dictionary<string, object>)
                    {
                        prevUrl = GetStr(entity["audioPreview"] as Dictionary<string, object>, "url");
                    }
                    string artistName = GetStr(entity, "subtitle", "Spotify Artist").Replace("\u00a0", " ");
                    if (entity.ContainsKey("artists") && entity["artists"] is System.Collections.ArrayList)
                    {
                        var aList = entity["artists"] as System.Collections.ArrayList;
                        var names = new List<string>();
                        foreach (object ao in aList)
                        {
                            var ad = ao as Dictionary<string, object>;
                            if (ad != null) names.Add(GetStr(ad, "name"));
                        }
                        if (names.Count > 0) artistName = string.Join(", ", names.ToArray());
                    }

                    trackListOut.Add(new Dictionary<string, object>
                    {
                        { "id", itemId },
                        { "uri", "spotify:track:" + itemId },
                        { "title", pName },
                        { "artist", artistName },
                        { "album", "Spotify Single" },
                        { "duration_ms", 200000 },
                        { "preview_url", prevUrl },
                        { "cover_url", coverUrl },
                        { "source", "spotify" }
                    });
                }

                SendJson(res, new Dictionary<string, object>
                {
                    { "id", itemId },
                    { "name", pName },
                    { "cover_url", coverUrl },
                    { "tracks", trackListOut }
                });
            }
        }

        private void HandleSpotifyResolveAudio(HttpListenerResponse res, string artist, string title, string previewUrl)
        {
            string targetAudioUrl = previewUrl;

            // If Spotify didn't provide a previewUrl, resolve real studio audio via iTunes / Deezer Search API!
            if (string.IsNullOrWhiteSpace(targetAudioUrl))
            {
                string cleanTitle = Regex.Replace(title ?? "", @"\s*[\(\[][^)\]]*[\)\]]", "").Trim();
                string query = Uri.EscapeDataString((artist + " " + cleanTitle).Trim());

                // 1. Try iTunes Plus AAC Search
                try
                {
                    HttpWebRequest itReq = (HttpWebRequest)WebRequest.Create("https://itunes.apple.com/search?term=" + query + "&media=music&entity=song&limit=1");
                    itReq.UserAgent = "Mozilla/5.0";
                    itReq.Timeout = 8000;
                    using (HttpWebResponse itResp = (HttpWebResponse)itReq.GetResponse())
                    using (StreamReader sr = new StreamReader(itResp.GetResponseStream(), Encoding.UTF8))
                    {
                        var data = _json.Deserialize<Dictionary<string, object>>(sr.ReadToEnd());
                        if (data != null && data.ContainsKey("results") && data["results"] is System.Collections.ArrayList)
                        {
                            var arr = data["results"] as System.Collections.ArrayList;
                            if (arr.Count > 0 && arr[0] is Dictionary<string, object>)
                            {
                                targetAudioUrl = GetStr(arr[0] as Dictionary<string, object>, "previewUrl");
                            }
                        }
                    }
                }
                catch { }

                // 2. Try Deezer MP3 Search fallback
                if (string.IsNullOrWhiteSpace(targetAudioUrl))
                {
                    try
                    {
                        HttpWebRequest dzReq = (HttpWebRequest)WebRequest.Create("https://api.deezer.com/search?q=" + query + "&limit=1");
                        dzReq.UserAgent = "Mozilla/5.0";
                        dzReq.Timeout = 8000;
                        using (HttpWebResponse dzResp = (HttpWebResponse)dzReq.GetResponse())
                        using (StreamReader sr = new StreamReader(dzResp.GetResponseStream(), Encoding.UTF8))
                        {
                            var data = _json.Deserialize<Dictionary<string, object>>(sr.ReadToEnd());
                            if (data != null && data.ContainsKey("data") && data["data"] is System.Collections.ArrayList)
                            {
                                var arr = data["data"] as System.Collections.ArrayList;
                                if (arr.Count > 0 && arr[0] is Dictionary<string, object>)
                                {
                                    targetAudioUrl = GetStr(arr[0] as Dictionary<string, object>, "preview");
                                }
                            }
                        }
                    }
                    catch { }
                }
            }

            if (string.IsNullOrWhiteSpace(targetAudioUrl))
            {
                res.StatusCode = 404;
                res.Close();
                return;
            }

            // Stream the resolved studio audio back to the Web Audio deck with CORS headers
            HttpWebRequest audioReq = (HttpWebRequest)WebRequest.Create(targetAudioUrl);
            audioReq.UserAgent = "Mozilla/5.0";
            audioReq.Timeout = 15000;
            using (HttpWebResponse audioResp = (HttpWebResponse)audioReq.GetResponse())
            using (Stream s = audioResp.GetResponseStream())
            using (MemoryStream ms = new MemoryStream())
            {
                s.CopyTo(ms);
                byte[] audioBytes = ms.ToArray();
                res.StatusCode = 200;
                string cType = audioResp.ContentType ?? "audio/mpeg";
                if (cType.Contains("m4p") || cType.Contains("m4a") || targetAudioUrl.Contains(".m4a"))
                {
                    cType = "audio/mp4";
                }
                res.ContentType = cType;
                res.AddHeader("Access-Control-Allow-Origin", "*");
                res.ContentLength64 = audioBytes.Length;
                res.OutputStream.Write(audioBytes, 0, audioBytes.Length);
                res.Close();
            }
        }

        private void HandleLocalScan(HttpListenerResponse res, string targetPath)
        {
            if (string.IsNullOrWhiteSpace(targetPath) || (!Directory.Exists(targetPath) && !File.Exists(targetPath)))
            {
                SendJson(res, new Dictionary<string, object> { { "ok", false }, { "error", "Path not found: " + targetPath } }, 400);
                return;
            }

            List<string> files = new List<string>();
            if (Directory.Exists(targetPath))
            {
                foreach (string f in Directory.GetFiles(targetPath, "*.*", SearchOption.AllDirectories))
                {
                    if (AudioExts.Contains(Path.GetExtension(f)))
                    {
                        files.Add(f);
                        if (files.Count >= 400) break;
                    }
                }
            }
            else if (File.Exists(targetPath) && AudioExts.Contains(Path.GetExtension(targetPath)))
            {
                files.Add(targetPath);
            }

            var tracks = new List<Dictionary<string, object>>();
            foreach (string f in files)
            {
                FileInfo fi = new FileInfo(f);
                string stem = Regex.Replace(Path.GetFileNameWithoutExtension(f), @"^\d{1,3}[\s._-]+", "");
                string artist = "Local Artist";
                string title = stem;
                int sep = stem.IndexOf(" - ");
                if (sep > 0)
                {
                    artist = stem.Substring(0, sep).Trim();
                    title = stem.Substring(sep + 3).Trim();
                }

                tracks.Add(new Dictionary<string, object>
                {
                    { "artist", artist },
                    { "title", title },
                    { "album", fi.Directory != null ? fi.Directory.Name : "Local Folder" },
                    { "duration_ms", 210000 },
                    { "path", fi.FullName },
                    { "size", fi.Length }
                });
            }

            SendJson(res, new Dictionary<string, object>
            {
                { "ok", true },
                { "tracks", tracks },
                { "count", tracks.Count }
            });
        }

        private void HandleLlmProxy(HttpListenerResponse res, Dictionary<string, object> payload)
        {
            string provider = GetStr(payload, "provider", "nvidia_nim");
            string apiKey = GetStr(payload, "apiKey").Trim();
            if (string.IsNullOrEmpty(apiKey))
            {
                var env = ReadEnv();
                if (env.ContainsKey("NVIDIA_NIM_API_KEY")) apiKey = env["NVIDIA_NIM_API_KEY"];
            }

            string model = GetStr(payload, "model").Trim();
            string sysPrompt = GetStr(payload, "systemPrompt");
            string usrPrompt = GetStr(payload, "userPrompt");
            string endpoint = GetStr(payload, "endpoint").Trim();

            string url = !string.IsNullOrEmpty(endpoint)
                ? endpoint
                : (provider == "nvidia_nim" ? "https://integrate.api.nvidia.com/v1/chat/completions" : "https://api.openai.com/v1/chat/completions");
            string chosenModel = !string.IsNullOrEmpty(model)
                ? model
                : (provider == "nvidia_nim" ? "meta/llama-3.3-70b-instruct" : "gpt-4o-mini");

            HttpWebRequest wr = (HttpWebRequest)WebRequest.Create(url);
            wr.Method = "POST";
            wr.ContentType = "application/json";
            wr.Timeout = 20000;
            if (!string.IsNullOrEmpty(apiKey))
            {
                wr.Headers["Authorization"] = "Bearer " + apiKey;
            }

            var reqObj = new Dictionary<string, object>
            {
                { "model", chosenModel },
                { "messages", new object[] {
                    new Dictionary<string, object> { { "role", "system" }, { "content", sysPrompt } },
                    new Dictionary<string, object> { { "role", "user" }, { "content", usrPrompt } }
                }},
                { "temperature", 0.85 },
                { "max_tokens", 220 }
            };

            byte[] reqBytes = Encoding.UTF8.GetBytes(_json.Serialize(reqObj));
            using (Stream reqStream = wr.GetRequestStream())
            {
                reqStream.Write(reqBytes, 0, reqBytes.Length);
            }

            using (HttpWebResponse resp = (HttpWebResponse)wr.GetResponse())
            using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            {
                var data = _json.Deserialize<Dictionary<string, object>>(sr.ReadToEnd());
                var choices = data["choices"] as System.Collections.ArrayList;
                var first = choices[0] as Dictionary<string, object>;
                var msg = first["message"] as Dictionary<string, object>;
                string txt = GetStr(msg, "content").Trim();
                SendJson(res, new Dictionary<string, object> { { "ok", true }, { "text", txt } });
            }
        }

        private List<string> SplitTextIntoChunks(string text, int maxLen = 220)
        {
            var chunks = new List<string>();
            if (string.IsNullOrWhiteSpace(text)) return chunks;

            string[] sentences = Regex.Split(text.Trim(), @"(?<=[.!?])\s+");
            StringBuilder current = new StringBuilder();

            foreach (string s in sentences)
            {
                string trimmed = s.Trim();
                if (string.IsNullOrEmpty(trimmed)) continue;

                if (current.Length + trimmed.Length + 1 <= maxLen)
                {
                    if (current.Length > 0) current.Append(" ");
                    current.Append(trimmed);
                }
                else
                {
                    if (current.Length > 0)
                    {
                        chunks.Add(current.ToString());
                        current.Clear();
                    }
                    if (trimmed.Length <= maxLen)
                    {
                        current.Append(trimmed);
                    }
                    else
                    {
                        // Split long sentence by clause/words
                        string[] words = trimmed.Split(' ');
                        foreach (string w in words)
                        {
                            if (current.Length + w.Length + 1 <= maxLen)
                            {
                                if (current.Length > 0) current.Append(" ");
                                current.Append(w);
                            }
                            else
                            {
                                if (current.Length > 0) chunks.Add(current.ToString());
                                current.Clear();
                                current.Append(w);
                            }
                        }
                    }
                }
            }
            if (current.Length > 0) chunks.Add(current.ToString());
            return chunks;
        }

        private void HandleRivaTtsProxy(HttpListenerResponse res, Dictionary<string, object> payload)
        {
            string endpoint = GetStr(payload, "endpoint", "").Trim();
            string text = GetStr(payload, "text").Trim();
            string voice = GetStr(payload, "voice", "en_us_001").Trim();

            // If user selected a local Riva HTTP container (e.g. localhost:9000) or Kokoro (localhost:8880), call it directly
            if (!string.IsNullOrEmpty(endpoint) && !endpoint.Contains("integrate.api.nvidia.com"))
            {
                try
                {
                    HttpWebRequest wr = (HttpWebRequest)WebRequest.Create(endpoint);
                    wr.Method = "POST";
                    wr.ContentType = "application/json";
                    wr.Timeout = 20000;
                    var reqObj = new Dictionary<string, object>
                    {
                        { "text", text },
                        { "input", text },
                        { "voice", voice },
                        { "response_format", "wav" }
                    };
                    byte[] reqBytes = Encoding.UTF8.GetBytes(_json.Serialize(reqObj));
                    using (Stream reqStream = wr.GetRequestStream())
                    {
                        reqStream.Write(reqBytes, 0, reqBytes.Length);
                    }
                    using (HttpWebResponse resp = (HttpWebResponse)wr.GetResponse())
                    using (Stream respStream = resp.GetResponseStream())
                    using (MemoryStream ms = new MemoryStream())
                    {
                        respStream.CopyTo(ms);
                        byte[] audioBytes = ms.ToArray();
                        res.StatusCode = 200;
                        res.ContentType = "audio/wav";
                        res.AddHeader("Access-Control-Allow-Origin", "*");
                        res.ContentLength64 = audioBytes.Length;
                        res.OutputStream.Write(audioBytes, 0, audioBytes.Length);
                        res.Close();
                        return;
                    }
                }
                catch { }
            }

            // High-Energy Horizon Neural DJ Synthesizer (supports en_us_001, en_uk_001, en_us_002, en_au_001)
            string neuralVoice = voice;
            if (string.IsNullOrEmpty(neuralVoice) || neuralVoice.StartsWith("English-"))
            {
                neuralVoice = "en_us_001"; // Energetic Upbeat US Female Radio Host
            }

            List<string> sentenceChunks = SplitTextIntoChunks(text, 260);
            List<string> base64AudioChunks = new List<string>();
            var localJson = new JavaScriptSerializer { MaxJsonLength = 50 * 1024 * 1024 };

            foreach (string chunk in sentenceChunks)
            {
                try
                {
                    HttpWebRequest wr = (HttpWebRequest)WebRequest.Create("https://tiktok-tts.weilnet.workers.dev/api/generation");
                    wr.Method = "POST";
                    wr.ContentType = "application/json";
                    wr.UserAgent = "Mozilla/5.0";
                    wr.Timeout = 12000;

                    byte[] bodyBytes = Encoding.UTF8.GetBytes(localJson.Serialize(new Dictionary<string, object>
                    {
                        { "text", chunk },
                        { "voice", neuralVoice }
                    }));

                    using (Stream rs = wr.GetRequestStream())
                    {
                        rs.Write(bodyBytes, 0, bodyBytes.Length);
                    }

                    using (HttpWebResponse resp = (HttpWebResponse)wr.GetResponse())
                    using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    {
                        var d = localJson.Deserialize<Dictionary<string, object>>(sr.ReadToEnd());
                        string b64 = GetStr(d, "data");
                        if (!string.IsNullOrEmpty(b64))
                        {
                            base64AudioChunks.Add(b64);
                        }
                    }
                }
                catch { }
            }

            SendJson(res, new Dictionary<string, object>
            {
                { "ok", base64AudioChunks.Count > 0 },
                { "chunks", base64AudioChunks },
                { "providerLabel", "Horizon Neural HD (" + neuralVoice + " Energetic)" }
            });
        }

        public void Dispose()
        {
            _running = false;
            try { _listener.Stop(); } catch { }
            try { _listener.Close(); } catch { }
        }
    }
}
