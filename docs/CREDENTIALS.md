# 番茄作者凭据：Cookie、CSRF Token 和 User Agent 怎么填

在 n8n 新建 **番茄作者 · 手动登录态（Fanqie） API** 凭据。这三个字段取自你已经登录的番茄作者后台的一条网络请求，按下面步骤复制即可。所有输入框选择 **固定值 / Fixed**。

如果只想查看节点的接口目录，执行 **Advanced API → Inspect Catalog** 即可，不需要填写凭据。

## 1. 在浏览器登录作者后台

用 Chrome 或 Edge 打开 [番茄作者后台](https://fanqienovel.com/main/writer/)，完成登录，确认能看到自己的作者工作台或作品列表。取值过程要在这个已登录的浏览器中进行。

## 2. 找到作者后台的一条成功请求

1. 在作者后台页面按 **F12**。也可以按 **Ctrl + Shift + I** 打开浏览器开发者工具。
2. 选择 **网络 / Network**，点击 **Fetch/XHR**。
3. 在筛选框输入 `/api/author/`，然后刷新作者后台页面。如果没有请求，点击后台的“作品管理”打开列表。
4. 点击列表中一条已经完成的账号或作品列表请求。在 **标头 / Headers → 常规 / General** 核对 **Request URL**：应是 `https://fanqienovel.com/api/author/...`。
5. 在 **预览 / Preview** 或 **响应 / Response** 查看请求是否返回正常的账号或列表数据。HTTP 状态为 200 也可能是登录错误；不要选择登录失败、验证码挑战或业务错误的请求。
6. 回到 **标头 / Headers**，展开 **请求标头 / Request Headers**。下面三个值都在这一节。请求头名称通常显示为小写。

Network 的筛选和请求头查看方法可参考 [Chrome 官方开发者工具说明](https://developer.chrome.com/docs/devtools/network/reference/#headers)。

## 3. 对应填写三个字段

### Cookie

找到请求标头中的 **`cookie`**，复制这一项的**完整值**，粘贴到 n8n 的 **Cookie**。

格式示例（全部是假值，不能直接使用）：

```text
cookie_name_1=YOUR_VALUE_1; cookie_name_2=YOUR_VALUE_2; cookie_name_3=YOUR_VALUE_3
```

只复制冒号后面的值，不包含 `Cookie:`，不额外加引号。多个 Cookie 之间保留分号；不要只复制其中一个 Cookie，也不要把响应里的 `Set-Cookie` 整行填进来。

若显示内容被折叠，先展开；如果浏览器提供 **查看源代码 / View source**，可以用它查看完整请求标头，再复制所需项的完整值。文字在页面上换行不等于值里需要换行，粘贴时保持完整内容。

### CSRF Token

在同一条请求的 **Request Headers** 中找到 **`x-secsdk-csrf-token`**，复制它的**完整值**，粘贴到 n8n 的 **CSRF Token**。

只复制冒号后面的值，不包含 `x-secsdk-csrf-token:`。保留原有大小写、符号和长度。

**不要用 Cookie 列表里的 `passport_csrf_token` 代替这个请求头，也不要填写作者 ID、验证码或自己编的值。** 这个字段用于发送 `X-Secsdk-Csrf-Token` 请求头。

如果当前请求没有这个头，先换一条当前登录会话中的成功账号、作品或章节列表请求。部分请求可能没有该头，不必为取值发布或删除章节。仍然找不到时，见下方排查说明。

### User Agent

在同一条请求的 **Request Headers** 中找到 **`user-agent`**，复制它的完整值，粘贴到 n8n 的 **User Agent**。

它通常以 `Mozilla/5.0` 开头。只填值，不包含 `User-Agent:`。输入框现有的 Chrome 字符串是节点预设值，不是自动读取的你的浏览器信息；优先替换为当前请求的真实值。

三个字段应来自同一个账号、同一次有效登录。若为寻找 CSRF 换了另一条请求，应在它上面重新复制三个值。

Cookie 和 CSRF 是账号登录凭据，只粘贴到 n8n 的凭据页。不要把值、完整请求截图或带凭据的 cURL/HAR 发到聊天、GitHub 或工作流 JSON 中。

## 4. 保存并验证

1. 点击 **保存 / Save**。如果 n8n 显示测试结果或提供 **测试 / Test、重新测试 / Retest**，查看结果；失败时按下方说明排查。
2. 在 **Fanqie Author** 节点中选择刚保存的凭据。
3. 先执行 **Account → Get**（查询账号），或导入仓库的 [账号和作品查询示例](../examples/account-and-books.json)。
4. 以节点实际返回正常账号或作品数据作为读取成功的依据。保存成功表示凭据已存入 n8n，不能单独证明番茄登录态有效；不要用发布或删除操作测试凭据。

凭据测试向 `/api/author/account/info/v0/` 发起读取请求，并检查业务返回 `code` 是否为 `0`。它不代表所有接口都已验证可用。

## 常见问题

### Network 没有请求

保持开发者工具打开再刷新页面，确认 Network 正在录制。如果 Fetch/XHR 没有结果，暂时切换 **全部 / All**，保留 `/api/author/` 筛选，打开“作品管理”重新查看。不要在 n8n 页面里寻找番茄请求。

### 找不到 Cookie 或 CSRF

确认查看的是 **Request Headers（请求标头）**，不是 **Response Headers（响应标头）** 或 **Payload（负载）**，并检查域名和路径。不要选图片、脚本、登录页、跨域的 OPTIONS 预检请求或未实际发送的“Provisional headers”请求。

有的请求不带 `x-secsdk-csrf-token`。如果当前成功的作者请求都没有它，请先停止填写，反馈请求的**域名、路径、方法、状态码，以及是否存在这些请求头**即可，不需要发送任何值。当前节点把 CSRF 设为必填，这种会话需要进一步核对适配，填写任意字符串不能解决。

### 提示登录失效、CSRF 错误或 401/403

在原浏览器重新登录作者后台，重新取一条新的成功请求，同时更新 Cookie、CSRF Token 和 User Agent，再重新测试。不要混用旧 Cookie、新 CSRF 或另一个账号的值。

如果官网本身要求验证码或安全校验，先在官网正常完成。若官网请求正常、n8n 仍失败，可能还涉及网络环境、请求签名、平台校验或接口变化；本包尚未完成真实作者账号联调，三个字段填写完整不等于已经排除了这些问题。

### 红字“此字段为必填字段”

说明 Cookie 或 CSRF Token 还没有有效输入。按第 3 步粘贴完整值，并确认选的是固定值。无需为这些字段编写 n8n 表达式。

### 后来突然不能使用

登录态会过期，也可能因退出登录或平台会话策略失效。重新登录、复制并更新上述三个字段即可重新检查；此版本不会自动登录或刷新番茄登录态。

## English quick reference

Sign in to your own Fanqie author workspace. In the browser's Network panel, inspect a successful `https://fanqienovel.com/api/author/...` request. Copy the full values of the `cookie`, `x-secsdk-csrf-token`, and `user-agent` **request headers** into the matching n8n credential fields. Exclude header names and do not substitute a CSRF cookie for the CSRF header. Use one current session, save, and verify with **Account → Get**. Update all three values after the session expires. Missing CSRF headers or platform challenges require further integration checks.
