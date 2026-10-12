# 番茄作者扫码连接

扫码方式适用于自建 n8n。管理员部署一次登录组件，用户在自己的浏览器打开连接页面，用手机扫码确认。无需浏览器扩展，无需复制 Cookie 或 CSRF。

二维码由组件的独立浏览器从番茄官方登录页获取。供 n8n 使用的网站登录态保存在管理员部署的组件中，不会读取用户本机浏览器里已有的登录态。这是社区节点的连接方式；组件和 n8n 之间采用 OAuth2 兼容的连接协议，不代表番茄提供了公开的第三方 OAuth 授权。

## 用户怎么操作

管理员先完成下文的实例级连接配置。随后用户可自行新增 **番茄作者 · 扫码登录（Fanqie） OAuth2 API** 凭据，不用填写组件地址、Client ID 或 Client Secret。每个凭据只能绑定一个作者账号；不同作者请使用不同凭据。

使用管理员配置的 n8n 主入口完成整个连接过程。如果 n8n 同时能通过局域网 IP 和域名打开，应从凭据页 **OAuth Redirect URL** 所对应的域名或 IP 进入 n8n，再点击连接。例如回调显示 `https://n8n.example.com/rest/oauth2-credential/callback`，就从 `https://n8n.example.com` 登录和连接。混用入口会让回调缺少原浏览器的登录 Cookie 或 OAuth 绑定 Cookie。

1. 在 n8n 新增凭据，搜索 **番茄**，选择 **番茄作者 · 扫码登录（Fanqie） OAuth2 API**。填写便于识别的名称，然后点击 **Connect my account / 连接账号**。
2. 新页面加载官方二维码。打开手机上的 **番茄小说**或**番茄作家助手**，使用 App 的扫一扫，扫描二维码并确认登录。
3. 等待页面显示账号检查通过并自动返回 n8n。节点选择 **登录方式 → 扫码登录（推荐）**，再选择这个凭据。
4. 先执行 **Account → Get**，确认返回自己的账号，然后执行 **Book → Get Many**。完成只读验证后再使用写入操作。

二维码过期时点击 **刷新二维码**。取消本次连接可以点击 **取消连接**。如果登录态失效，重新打开同一个凭据并连接账号即可。

**现有 version 1 工作流默认继续使用原来的手动登录态。** 旧节点现在也能显式选择扫码，无需先升级节点版本。新节点的 version 1.1 默认选扫码；也可以选择 **手动登录态**。节点不会自动迁移或覆盖旧凭据。

如果新增凭据时只看到 Cookie 和 CSRF，选择的是 **番茄作者 · 手动登录态（Fanqie） API**。返回凭据类型选择页，搜索“番茄”并选择扫码类型。节点升级或管理员配置后，刷新一次 n8n 页面以加载最新凭据列表。

## 管理员部署

需要能访问番茄官网的服务器、Docker Compose、自建 n8n，以及浏览器和 n8n 都可访问的组件地址。组件使用 Playwright Chromium，默认最多两人同时扫码，容器内存上限为 1 GiB。

从本仓库取得 `login-service/` 目录，进入该目录后：

```sh
cp .env.example .env
chmod 600 .env
```

编辑 `.env`：

| 配置                     | 填写方式                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`             | 组件的外部地址，例如 `https://fanqie-login.example.com`                                                                     |
| `CLIENT_ID`              | 自定标识，例如 `fanqie-n8n`                                                                                                 |
| `CLIENT_SECRET`          | 独立的随机密钥，至少 32 字符                                                                                                |
| `SESSION_ENCRYPTION_KEY` | 32 个随机字节的 Base64 编码，保存好，重启时使用同一个值                                                                     |
| `REDIRECT_URIS`          | n8n 凭据页显示的 OAuth Redirect URL；由实例的入口配置决定，不能只按当前浏览器地址猜测。必须完整一致，多个地址用英文逗号分隔 |
| `BIND_ADDRESS`           | 默认 `127.0.0.1`，便于通过 HTTPS 反向代理访问                                                                               |
| `ALLOW_INSECURE_HTTP`    | 公网保持 `false`；仅在可信局域网调试时设为 `true`，且地址必须为局域网或回环 IP                                              |
| `SESSION_TTL_HOURS`      | 组件保存连接的上限，默认 720 小时；番茄登录态可能更早失效                                                                   |
| `MAX_LOGIN_SESSIONS`     | 同时扫码人数，默认 2，范围 1–8                                                                                              |

生成两项独立密钥，可以分别运行：

```sh
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
python3 -c 'import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())'
```

第一项填入 `CLIENT_SECRET`，第二项填入 `SESSION_ENCRYPTION_KEY`。这些值只用于管理员配置，不应提交到 Git、聊天或工单。

准备组件的持久化数据目录。当前 Docker 镜像中 `pwuser` 的 UID/GID 为 1001：

```sh
mkdir -p data
chown 1001:1001 data
chmod 700 data
docker compose up -d --build
```

公网部署应通过 HTTPS 反向代理访问端口 8789，并保留正确的 `Host` 请求头。`PUBLIC_URL` 必须和浏览器地址完全一致；反向代理的上游超时建议至少 150 秒。不需要 WebSocket，也不用公开远程桌面。

组件 `/health` 返回 `{"status":"ok"}` 表示进程已就绪。打开首页会显示“扫码连接组件已就绪”；二维码须从 n8n 的连接按钮发起，直接打开首页不会创建登录会话。

## n8n 凭据配置

推荐使用 n8n 原生的实例级凭据配置，让所有新建扫码凭据共用组件的客户端配置，同时各自保存独立账号的连接令牌。此方式已在 n8n 2.42.6 验证，前端仅收到被隐藏的字段名，不会收到 Client Secret。

在 n8n 的持久化目录中创建私有文件 `fanqie-qr-overwrites.json`：

```json
{
	"fanqieAuthorQrLoginOAuth2Api": {
		"loginServiceUrl": "https://fanqie-login.example.com",
		"clientId": "fanqie-n8n",
		"clientSecret": "填写组件的独立随机 Client Secret",
		"authUrl": "https://fanqie-login.example.com/oauth/authorize",
		"accessTokenUrl": "https://fanqie-login.example.com/oauth/token"
	}
}
```

使用组件 `.env` 中的实际配置替换示例。文件应由 n8n 运行用户拥有、权限为 `600`，不能放入 Git。然后给 n8n 设置：

```text
CREDENTIALS_OVERWRITE_DATA_FILE=/home/node/.n8n/fanqie-qr-overwrites.json
```

Docker 部署将此变量加到 **n8n 容器**的环境变量中，重建该容器后刷新页面。如果实例已设置其他凭据覆盖配置，应合并现有 JSON，保留其他类型的配置。不要把 Client Secret 写入节点源码或前端默认值。

接下来用户新增扫码凭据即可直接连接。服务地址、Client ID、Client Secret 会由服务器注入并从表单隐藏。组件 `REDIRECT_URIS` 仍须与 n8n 凭据页显示的完整 **OAuth Redirect URL** 一致。

### n8n 使用全局 HTTP 代理时

如果 n8n 设置了 `HTTP_PROXY` / `HTTPS_PROXY`，应把登录组件地址中的主机名或 IP 加入 **n8n 容器**的 `NO_PROXY` 和 `no_proxy`，保留已有的直连名单。例如组件地址是 `http://192.168.1.10:8789`，在原名单后追加 `192.168.1.10`；如果使用 Docker 服务名访问，则追加该服务名。填写主机名或 IP，不填写整个 URL。

两个变量使用相同名单。保存到 n8n 的 Compose 配置后运行 `docker compose up -d --no-deps n8n`，让容器载入新环境变量；仅执行 `restart` 不会更新这些变量。此设置保留其他外网请求的代理配置。

排查时从 **n8n 容器内部**请求组件的 `/health`，使用和节点相同的组件地址。例如将下方地址替换为实际地址：

```sh
docker exec <n8n容器名> node -e 'fetch("http://192.168.1.10:8789/health", {signal: AbortSignal.timeout(10000)}).then(async r => {console.log(r.status, await r.text()); process.exitCode = r.ok ? 0 : 1}).catch(() => {console.error("组件连接失败"); process.exitCode = 1})'
```

收到 `200 {"status":"ok"}` 后，再运行 **Account → Get**。宿主机或用户浏览器能打开组件，并不代表 n8n 容器使用代理时也能连通；`/health` 通过也只表示组件连通，账号读取才能进一步确认番茄访问和登录态。

如果你的 n8n 不支持此实例级配置，管理员可以逐个预配置扫码凭据：**Login Service URL** 填 `PUBLIC_URL`，**Client ID** 和 **Client Secret** 填组件配置的同名值，再交给使用者扫码。

Client Secret 是登录组件的独立随机密钥，不使用 npm Token、GitHub Token 或番茄 Cookie。

## 会话如何保存

每次扫码使用独立浏览器上下文。组件观察官方作者请求的 Cookie、CSRF 和 User Agent；只读请求没有 CSRF 时，通过页面加载的官方 SecSDK 执行只读 HEAD 握手取得 CSRF。随后用完整登录态检查作者账号接口，只有检查通过才允许绑定。

组件通过 state、S256 PKCE、精确回调地址和一次性连接码完成 n8n 绑定。n8n 只获得不透明连接令牌，网站 Cookie 和 CSRF 使用 AES-256-GCM 加密后存放在 `data/`。节点调用作者接口时，由组件向固定的 `https://fanqienovel.com/api/author/` 路径发出请求。不会跟随登录重定向，不会自动重试写入请求。

备份时同时保存 `.env` 和 `data/`，并限制访问权限。丢失或更换加密密钥会导致已保存登录态无法读取；恢复原密钥可以恢复访问。用户需要重新登录时，重新扫码会生成新的连接令牌。旧连接在保留期限内仍然有效，可通过组件的认证接口 `POST /api/session/revoke` 主动撤销；删除 n8n 凭据本身不会通知组件撤销。

## 常见问题

- **节点报 HTTP 502，但扫码组件运行正常**：先检查 n8n 到组件的连接。全局 HTTP 代理可能把内网组件请求转发到代理并返回 502；按上文把组件主机加入 `NO_PROXY` / `no_proxy` 后重新创建 n8n 容器，再执行账号读取。不要仅凭 502 判断登录态失效。
- **显示 Client ID/Secret 不匹配**：核对组件 `.env` 与 n8n 凭据，修改配置后重启组件。
- **回调地址未登记**：复制 n8n 凭据页的完整 OAuth Redirect URL，更新 `REDIRECT_URIS` 后重新创建组件容器（`docker compose up -d`）。仅 `docker compose restart` 不会载入新的 `.env`。自建 n8n 的回调通常取自 `N8N_EDITOR_BASE_URL`，它可能与当前浏览器使用的局域网 IP 不同。只登记实际使用的精确回调地址，不使用通配符。
- **扫码后提示从不同浏览器发起或 Unauthorized**：回到 OAuth Redirect URL 对应的 n8n 主入口，登录后重新点连接。连接前后使用同一个浏览器和同一个 n8n 域名/IP；不要关闭浏览器绑定、Cookie 或回调认证检查来规避错误。
- **一直在准备二维码**：检查服务器能否访问番茄官网和官方资源域名，以及容器内存。组件仅允许官方站点相关域名的 HTTPS 请求。
- **扫码后提示需要额外验证**：查看手机提示；本版本不提供远程验证码操作界面。重新连接仍失败时，需要管理员排查该账号和服务器环境。
- **已登录但作者凭据不完整**：确认页面成功加载官方 SecSDK，且 CSRF 握手未被网络或平台验证阻断。组件不会接受 SDK 的 `DOWNGRADE` 降级标记，也不会用其他 Cookie 猜测替代 CSRF。
- **作者接口没有接受登录态**：扫码成功不代表作者权限或接口验证通过。确认 App 中账号已开通作者身份，重新扫码；管理员可检查只包含状态的日志，避免记录会话值。
- **重启后不能读取登录态**：保持原来的 `SESSION_ENCRYPTION_KEY` 和 `data/`，不要重新生成密钥覆盖它们。

扫码功能不改变作品、章节、数据和收益接口的实验性状态。加密收益协议仍未实现；接口兼容性和账号权限仍需要实际联调验证。
