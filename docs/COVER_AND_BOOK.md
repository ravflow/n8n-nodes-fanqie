# 封面上传与自动建书

从 `0.1.1-alpha.5` 开始，节点提供 **Media · 封面 → Upload Cover** 和 **Book → Create With Cover**。扫码凭据与手动登录态都可使用。扫码用户的管理员需要同时升级随包提供的登录组件到 `0.3.0`。

## 已经有图片：上传并取得封面 URI

1. 将生图、下载或读取文件节点连接到 **Fanqie Author**。
2. 选择 **Media · 封面 → Upload Cover**。生图节点输出二进制文件时，选择 **Binary Data**，填写文件所在的字段名，通常是 `data`。返回 Base64 的接口可以选择 **Base64**，通过表达式传入该字符串或图片 data URL。
3. 根据图片实际来源选择 **AI-Generated** 或 **Original / Non-AI**。AI 图片会携带官网使用的 AI 标记及水印参数上传。
4. 执行成功后取得 `thumb_uri`、`pic_uri` 和 `pic_url`。建书或修改作品封面时使用 `thumb_uri`；`pic_url` 是图片地址，不要用它替代 URI。

支持 PNG/JPEG，最大 5 MiB。节点检查实际文件头与尺寸，不依赖文件名扩展名。建议在生图后使用 n8n 的 **Edit Image** 自动处理为 600×800。封面需要包含正确书名和作者笔名；详见[番茄封面要求](https://fanqienovel.com/writer/zone/article/7257099961290981431)。图片内容和平台审核结果仍需实际检查。

## 一步上传封面并创建作品

选择 **Book → Create With Cover**，填写：

- **Book Name**：1–15 个字符，支持中英文、数字及 `，：！？【】`，不含空格。
- **Audience · 目标读者**：男频为 1，女频为 0。
- **Category Names or IDs**：从当前账号的实时列表中选择，必须恰好一个“主分类”；“主题”“角色”“情节”各最多两个。切换读者频道后重新选择分类。
- **Abstract**：50–500 字简介。
- **Roles**：一个或两个主角名，以逗号分隔或填写 JSON 字符串数组，每个名字 1–5 个字符且不能重名。
- **Writing Mode**：连载模式或完本模式。
- **Cover Source / Input Binary Field / Image Origin**：与 Upload Cover 相同。已经上传过封面时，选择 **Already Uploaded URI** 并填写 `thumb_uri`，可跳过上传。
- **Create Initial Volume**：如需继续自动建立章节草稿，可以开启，并填写首卷名称。

执行顺序是：校验输入和账号分类 → 上传封面 → 创建作品 → 按选项创建首卷。输出的 `book_id`、`volume_id`、`volume_name` 可以直接连接 **Draft → Create**。这些长编号始终按字符串传递。

旧版 **Book → Create** 继续支持传入已有封面 URI；新增的组合操作负责上传和建书之间的数据传递。

## 自动生图工作流

仓库提供 [AI 生图 → 封面 → 建书 → 首卷示例](../examples/ai-cover-and-create-book.json)。导入后选择你的生图凭据、番茄作者凭据，填写书名、笔名、简介、主角和分类。示例使用 n8n 自带 OpenAI 生图节点，你可以换成其他能输出 PNG/JPEG 二进制数据的生图节点。

示例的 Edit Image 步骤将竖图缩放、裁剪到 600×800。运行它需要实例支持该内置节点所需的 GraphicsMagick；当前联调服务器已具备。生图费用由所选图片服务计费。工作流默认未启用，填写正式作品资料、检查生成封面后再执行建书步骤。

## 失败后怎样继续

写入请求不会自动重试。网络超时可能发生在服务器已经完成写入之后，先查询结果再决定是否重试。

- **封面上传后建书失败**：错误包含已上传的 `thumb_uri`。先通过 Book → Get Many 查有无新书；确认未创建时，用 Already Uploaded URI 重试建书。
- **建书成功、建卷失败**：错误包含真实 `book_id`，先用 Volume → Get Many 检查，再继续 Volume → Create。不要重新建书。
- **开启 Continue On Fail**：错误输出包含 `stage`、已取得的 URI/编号和 `recovery`，便于工作流分支处理。
- **草稿创建后保存失败**：保留返回的 `item_id`，使用 Draft → Save 恢复，避免再建一个草稿。

## 验证范围

2026-10-12 已通过真实扫码账号上传一张 600×800 测试图，番茄返回 HTTP 200、业务码 0、有效 `pic_uri` 和 `pic_url`。分类读取已通过真实账号验证。上传、自动建书顺序、长编号、参数检查、失败恢复和两种认证分支有自动测试。

真实建书、建卷、章节发布以及非空列表分页应在实际选定作品上继续验证；上传成功不等于作品或封面已审核通过。本轮通用节点完善未将示例作品发布到用户账号。

上传格式依据官网实际前端：[封面上传组件](https://lf-serial-static.fanqienovel.com/obj/novel-serial-cdn/toutiao/muye/main/static/js/async/6840.717784f3.js)、[AI 封面上传参数](https://lf-serial-static.fanqienovel.com/obj/novel-serial-cdn/toutiao/muye/main/static/js/async/9318.9adcd3a2.js)、[建书表单](https://lf-serial-static.fanqienovel.com/obj/novel-serial-cdn/toutiao/muye/main/static/js/async/8034.ab6abd6f.js)。这是网站接口适配，并非公开开发者 API 的兼容性承诺。
