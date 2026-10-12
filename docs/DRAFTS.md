# 草稿创建、保存与恢复

**Draft → Create** 会先申请编辑器编号、检查编辑器状态，再保存正文。申请到编号不等于正文已存入草稿箱。节点只有回读确认正文、标题和未发布状态一致后，才返回 `action: draftSaved` 和 `draftVerified: true`。

新版协同编辑器使用 `/api/author/article/cover_article/v0/` 保存，旧编辑器使用 `/api/author/publish_article/v0/` 的草稿模式。接口选择来自作者后台的 `permission_switch`；节点不会在新版保存失败后改用发布接口。

已有编号显示已发布时，Draft Save 会停止，不修改该章节。修改或发布已有章节属于单独的 Chapter 操作。错误码 `-100` 本身不能证明请求没有产生状态变化，需要先查询编号的实际状态。

## 从失败中恢复

1. 先用 **Draft → Get Many** 查询草稿箱；用 **Chapter → Get** 查询报错编号的 `publish_status`。只有 `publish_status: 0` 才能作为未发布草稿继续保存。
2. 选择 **Draft → Save**，填写原有 Item ID，或保留 **Draft → Create** 并填写 **Existing Draft ID**。后者会跳过申请新编号。
3. 新版编辑器更新正文时使用回读得到的版本号。也可在 Parameters JSON 中传 `item_version`，要求与当前版本一致；不一致时停止，避免覆盖后来修改。
4. 保存后检查 `draftVerified: true` 和 `latest_version`，再把返回的 `item_id` 写入自己的数据表。工作流恢复或重跑时，把该 ID 传给 Existing Draft ID。

初次保存空白、版本为零的协同文档时，官方自动保存流程省略 `item_version`。节点只对空白文档使用这种初始化方式；已有正文却没有有效版本号时会停止。写入失败不自动重试，也不自动删除草稿或章节。

一次实际账号联调已确认：新版接口成功保存了标题和正文，回读版本为 1，`publish_status` 为 0，编号出现在草稿箱中。这不代表所有账号、编辑器版本或其他写入操作都已验证。
