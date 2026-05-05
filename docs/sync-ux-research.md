# Sync UX 预研:是否应向普通用户暴露 git 概念

> 状态:研究草稿,未做决策。
> 日期:2026-05-04
> 范围:PicG 桌面端的相册同步交互模型。

## 1. 问题陈述

PicG 把 GitHub 仓库当作相册的存储后端。这是一个工程上很自然、但产品上很别扭的选择——
git 的 pull / push / commit / branch / SHA 是为程序员协作设计的版本控制概念,
而 PicG 的目标用户(摄影师 / 普通照片管理者)的心智模型来自 iCloud Photos、Google Photos、Dropbox:

> "我的照片就在那儿,会自己同步。"

而非:

> "我有本地副本和远端副本,我需要 pull 让远端的变化下来,push 让本地的变化上去。"

当前 UI 里 "Sync" 按钮其实只做 `git pull`(见 [GalleryRegistry.ts:332](../electron/galleries/GalleryRegistry.ts))——
这是一个抽象漏出的典型例子:**按钮叫 "同步" 但只做了一半**,用户大概率会误解。

本文档目的:
1. 系统盘点 PicG 当前所有 "git 泄漏点"
2. 梳理业界对 "git-backed 用户应用" 的既有抽象方案
3. 提出一个候选的 photo-centric 抽象模型,标出权衡和边界场景
4. **不是决策**——是一份用于讨论的草稿

---

## 2. PicG 当前 git 泄漏盘点

### 2.1 用户可见的 git 词汇/概念

| 位置 | 文件:行 | 暴露的 git 概念 |
|---|---|---|
| 相册详情页:Pull 按钮 tooltip | [src/app/desktop/galleries/[id]/page.tsx:328](../src/app/desktop/galleries/[id]/page.tsx) | "Pull from remote (git pull)" |
| 相册详情页:Push 按钮 tooltip | [src/app/desktop/galleries/[id]/page.tsx:338](../src/app/desktop/galleries/[id]/page.tsx) | "Push N commit(s) to remote (git push)" |
| 相册详情页:分支名 | [src/app/desktop/galleries/[id]/page.tsx:362](../src/app/desktop/galleries/[id]/page.tsx) | `main` / `master` 字面显示 |
| Push 按钮 badge | [src/app/desktop/galleries/[id]/page.tsx:343](../src/app/desktop/galleries/[id]/page.tsx) | ahead 计数(未推送的 commit 数) |
| 相册卡片:Sync 按钮 | [src/app/desktop/galleries/page.tsx:538](../src/app/desktop/galleries/page.tsx) | "Sync"(实际只做 pull) |
| 相册列表:克隆中状态 | [src/app/desktop/galleries/page.tsx:403,441](../src/app/desktop/galleries/page.tsx) | "cloning"、"receiving objects"、"resolving deltas"、"compressing"、"writing" |
| 添加相册:复制仓库 | [src/app/desktop/galleries/page.tsx:549,559](../src/app/desktop/galleries/page.tsx) | "clone one from your GitHub"、"Choose a repo to clone" |
| Push 回执卡 | [src/components/desktop/PushReceiptCard.tsx](../src/components/desktop/PushReceiptCard.tsx) | "Pushed N ops as 1 commit"、`fullName`、`branch`、commit SHA(7 位短哈希)、"Authored as <git identity>"、"N different identities"、"N ops collapsed" |
| Undo 拒绝原因 | [src/components/desktop/UndoToast.tsx:214](../src/components/desktop/UndoToast.tsx) | "Already pushed — undo would rewrite remote history"、"No prior commit to roll back to"、"Working tree has uncommitted changes" |

### 2.2 用户主动触发的 git 操作

| 用户动作 | 触发的 git 操作 | 实现位置 |
|---|---|---|
| Add gallery → Choose repo | `git clone <token-url>` + 进度事件 | [GalleryRegistry.ts:166-300](../electron/galleries/GalleryRegistry.ts) |
| Sync 按钮(列表/详情) | `git pull <token-url> <branch>` | [GalleryRegistry.ts:332-353](../electron/galleries/GalleryRegistry.ts) |
| Push 按钮 | 收集未推送 commits → squash 合并 → `git push <token-url> HEAD:<branch>` → 写 tracking ref | [GalleryRegistry.ts:355-467](../electron/galleries/GalleryRegistry.ts) |
| Undo 弹窗 | `git reset --hard HEAD~1`(仅在未推送、无未提交修改时允许) | [GalleryRegistry.ts:527-559](../electron/galleries/GalleryRegistry.ts) |
| Remove gallery | 删除本地工作目录 | [GalleryRegistry.ts:323-330](../electron/galleries/GalleryRegistry.ts) |

### 2.3 隐式自动 git 操作

| 触发时机 | 自动执行 | 用户可见反馈 |
|---|---|---|
| 任意写入(新建相册、删除照片、改封面、压缩) | 自动 commit,消息硬编码("Add new album: X"、"Delete N photo(s)"…) | 不显示消息;仅 ahead 计数 +1 |
| 写入完成后(若 `PICG_AUTOPUSH=1`) | 自动 push | 当前未在 UI 暴露开关 |
| 应用启动 | `listInFlight` 恢复中断的 clone | 卡片继续显示 cloning 状态 |
| Push 完成 | squash 多个本地 commit 为一个 | PushReceiptCard 列出被合并的 ops |

### 2.4 用户必须配置的 git-shaped 设置

实际上**几乎为零**——已经做得不错:
- 身份(identity):从 GitHub OAuth 自动取
- Token:存系统钥匙串,操作时自动注入
- Remote URL:clone 时定型,token 不落盘
- 分支:从仓库 default branch 自动取
- Commit message:全部硬编码模板

**用户唯一要做的"git 配置"是选一个仓库去 clone。** 这是个好基线——意味着抽象成本主要在 UI 层,不在配置层。

### 2.5 已经被很好抽象掉的部分

值得注意的是,PicG 已经隐藏了不少:
- ✅ commit 消息从未展示给用户
- ✅ push 时 squash 多个 commit 为一个,远端历史干净
- ✅ token / 凭据全自动管理
- ✅ git identity 从 OAuth 自动配
- ✅ 分支只读不可改

**所以现在 PicG 处在 "半抽象" 状态:数据流上 git 几乎全自动,UI 上仍然按 git 操作划分按钮**。这是一个矛盾点,也是机会点——
后端已经做好了,只要重做 UI 模型就能拉到全抽象。

---

## 3. 业界做法谱系

研究了五类参考产品,大致可以归为四种 UX 哲学。

### 3.1 完全隐藏(Dropbox / iCloud Photos / Google Photos)

**心智模型:** 状态(state),不是动作(action)。

- 用户不需要按按钮;同步在后台持续发生
- 唯一的 UI 是**状态指示**:✓ 已同步 / ⟳ 同步中 / ⏸ 已暂停 / ⚠ 需要注意
- 词汇:Dropbox 用 "Indexing"、"Syncing X files"、"Your files are up to date"、"Syncing paused"。完全没有 pull/push/commit/branch
- 控制点:只有"暂停同步"和"选择性同步"(Smart Sync)

**适用前提:** 用户写入是常态,冲突极少(同一文件极少被两端同时改),网络带宽够用。
**代价:** 失去显式控制(用户无法说"我现在不想推上去")。

### 3.2 设计师向半抽象(Abstract for Sketch)

**心智模型:** 保留 git 概念,但翻译成视觉化的设计师词汇。

- "Branch" → "Project version"
- "Commit" → "Save change"
- "Pull request" → "Review request"
- 但底层流程(分叉 → 提交 → 合并)还在,只是名字换了
- Abstract 后来失败的原因之一就是这个抽象其实没真正消除心智成本——只是翻译了术语

**教训:** 单纯换词没用。要么彻底改模型,要么保持原样。**翻译式抽象是最坏的——既丢了 git 用户的预期,又没让小白用户真的理解。**

### 3.3 简化但不隐藏(GitHub Desktop / Kactus)

**心智模型:** 还是 git,但用大按钮代替命令行。

- 按钮还叫 "Commit to main"、"Push origin"、"Fetch"
- 设计哲学:目标是**降低执行门槛**,不是**降低概念门槛**
- 假定用户愿意学 git 概念,只是不想敲命令行
- Kactus 明确说:"不回避原始术语,因为目标是连接设计师和开发者用同一套工作流"

**适用前提:** 用户群本身就是泛技术人群,或者会与开发者协作。
**对 PicG 不太合适:** 摄影师不是要和开发者协作。

### 3.4 自动化掩盖(Obsidian Git 插件 — "Auto commit-and-sync")

**心智模型:** git 还在,但用户从不亲自调度。

- 设定一个时间间隔(比如每 10 分钟)
- 插件自动:本地 commit → pull → 解决冲突或失败提示 → push
- 用户的可见 UI 只有"上次同步:5 分钟前 ✓"
- 出问题时才在通知里告诉你
- 这是 Obsidian 用户向"set it and forget it"靠近的实际方案

**适用前提:** 写入频率低于同步频率(笔记大体如此;照片也是)。
**代价:** 后台冲突需要专门 UI 兜底;离线编辑后再上线时可能有惊喜。

### 3.5 PicG 现状

PicG 在 3.3 和 3.4 之间——保留 git 词汇(Pull / Push 按钮),但不让用户写 commit message。
这是**最尴尬的位置**:既不够程序员(不能控制 commit/branch),又不够普通用户(还要看 ahead 计数)。

---

## 4. 推荐模型:photo-centric 状态机

设计原则:

1. **用户看到状态,不看到动作**——主 UI 不出现 Pull / Push / Commit / Branch / SHA
2. **同步是默认行为,不是用户主动决定**——后台自动化覆盖 90% 场景
3. **保留显式入口给"高级用户"**——藏在二级菜单,不影响主线
4. **冲突 / 错误走专门 UI**——不直接抛 git 错误信息

### 4.1 状态模型

每个相册始终处于以下状态之一:

| 状态 | 含义 | 视觉 | 当前 git 等价 |
|---|---|---|---|
| **已同步**(Up to date) | 本地与云端一致 | ✓ 灰色 | ahead=0, behind=0, dirty=false |
| **同步中**(Syncing) | 后台拉取/推送进行中 | ⟳ 旋转 | clone / pull / push 进行中 |
| **有未上传的更改**(Pending upload) | 本地领先云端 | ↑ 蓝点 + 数字(可选) | ahead>0 |
| **云端有更新**(Updates available) | 云端领先本地 | ↓ 蓝点 | behind>0 |
| **需要处理**(Needs attention) | 冲突 / 网络 / 鉴权失败 | ⚠ 黄色 | merge conflict / push rejected / auth failed |
| **正在下载**(Setting up) | 首次 clone 中 | ⟳ 进度条 + "下载 X / Y 张" | clone 进行中 |

### 4.2 用户动作

主 UI 上**只有一个同步动作**:

> **"立即同步"** — 等价于 pull → 如果有本地更改则 push → 失败时给清晰错误

其他动作都是**对照片本身的操作**(添加、删除、整理),底层是否产生 commit/push 用户不感知。

### 4.3 自动化策略

| 时机 | 行为 |
|---|---|
| 应用启动 | 后台对所有相册做 pull(已有逻辑) |
| 窗口获得焦点 | 后台 pull 上次操作 >5 分钟的相册 |
| 用户上传/删除/编辑后 | debounce 30 秒后自动 push(可在设置里关闭) |
| 网络从断到通 | 自动重试待发的同步 |

### 4.4 词汇翻译表

| 当前 | 改为 |
|---|---|
| Pull | (主 UI 不出现;Sync 内部行为) |
| Push | (主 UI 不出现;自动触发或 Sync 内部) |
| Sync(只 pull) | "立即同步"(pull + push) |
| Cloning | "正在下载相册" |
| receiving objects / resolving deltas / compressing / writing | 隐藏,只显示 "下载 X / Y 张照片" 或简单进度条 |
| Branch (`main`) | 隐藏(高级菜单可见) |
| ahead N commits | "X 项更改未上传" |
| behind N commits | "云端有更新" |
| commit SHA in PushReceipt | 隐藏;改为 "保存到云端 · 14:32 · 在 GitHub 查看 →" |
| "Pushed N ops as 1 commit" | "已上传 N 项更改" |
| "Authored as <identity>" | 隐藏(高级菜单可见) |
| "N different identities collapsed" | 隐藏 |
| "Already pushed — undo would rewrite remote history" | "这些更改已经上传到云端,无法在此撤销" |
| "Working tree has uncommitted changes" | "你有未保存的更改,请先同步再撤销" |

---

## 5. 边界场景

抽象方案要扛得住非主线场景。下面是必须想清楚的几个:

### 5.1 真冲突(同一文件双端修改)

照片场景里这种冲突极少——大多数操作是新增,删除是单点决定。可能出现的真冲突:
- README.yml 双端编辑(改相册顺序、封面)
- 同一张照片在两端被压缩成不同的版本

**建议处理:** 走专门冲突 UI,例如:

> "这个相册在云端和本地都有改动。你想要:
>  ① 用云端的版本(本地改动会丢)
>  ② 用本地的版本(云端改动会丢)
>  ③ 我手动看一下"

最后一项打开高级界面(显示 git diff 或文件列表)。

### 5.2 离线编辑

用户离线时编辑了大量照片,联网后:
- 拉云端 → 通常没冲突 → 自动推
- 拉云端 → 冲突 → 走 5.1
- 推失败(网络不稳) → 重试,持续显示 "有未上传的更改"

**关键设计点:** 离线积累的本地 commit 永远不丢。当前 squash 逻辑在这里会非常有用——
不管本地积了 50 个 commit,推上去就一个。

### 5.3 已推送的 undo

当前行为:拒绝。
新行为:也拒绝,但话术换成 "这些更改已经在云端,无法撤销;如需恢复以前版本,可在 GitHub 上查看历史版本"。

更激进:支持 "回退到 N 张照片之前" 的语义化 undo,底层是 revert commit(新建反向 commit)而不是 reset(改写历史)。

### 5.4 多设备同时改

设备 A 改了相册顺序,推上去;设备 B 也改了,但还没推。
B 上 "立即同步" 时:
- pull 拉到 A 的改动 → 三种可能:
  - 自动合并成功 → push
  - 冲突 → 走 5.1
  - 失败 → 报错

### 5.5 鉴权过期 / 网络断

不要抛 "fatal: Authentication failed" 这类原文。
改为:"无法连接到 GitHub,请检查网络或重新登录"。
全局放一个 "同步状态" 区域,聚合显示是否所有相册都健康。

### 5.6 用户想看到底层(开发者用户)

PicG 的早期用户群可能就有不少开发者(因为它绑定 GitHub),他们可能更喜欢看到 commit/branch 信息。

**建议:** 设置里一个 "开发者视图" 开关:
- 关:走新模型
- 开:像现在一样显示 Pull/Push/Branch/SHA

或者在 Push 回执的 "查看详情" 里展开当前的全部信息。

---

## 6. 风险与开放问题

### 6.1 风险

1. **静默 push 风险**:自动 push 可能把用户不想发布的状态推上去。
   缓解:debounce + 设置开关 + 第一次自动 push 前给一个 "下次开始自动同步" 提示。

2. **状态判断复杂**:ahead/behind/dirty 三个维度组合出来的状态比想象多。
   实测下来要不要细分 "已同步但还在压缩" 等中间态需要数据。

3. **失败回归到 git 错误信息**:翻译话术覆盖不全时,底层报错会原样冒出来,用户更困惑。
   要做一个错误码 → 中文话术的映射表,默认回退到 "同步失败,请稍后重试"。

4. **改名字的迁移成本**:老用户已经习惯 Sync 按钮,突然变成"立即同步"或图标变化会有学习成本。
   缓解:版本说明里明确告知;首次启动新版给一个 1 屏的引导。

### 6.2 开放问题(需要数据或用户访谈才能回答)

1. PicG 实际用户里**程序员占比有多高**?如果 >50%,3.3 路线(GitHub Desktop 风)可能比 4.X 更合适。
2. 用户对 "自动 push" 的接受度?有的人会强烈希望"我点了才推"。
3. 多设备使用比例?如果绝大多数人只在一台机器上用,pull/push 的复杂度可以更激进地折叠。
4. 离线场景的频率?决定 5.2 要做到多扎实。

---

## 7. 建议的分阶段路径

如果决定走 4.X 路线,建议**不要一次性大改**,而是分阶段:

### 阶段 1:词汇与状态(改动小,风险低)

- 把 Pull/Push 按钮文案改成更普通话(标题 tooltip 也改)
- 列表卡片改用统一状态徽标,不再单独露 "Sync" 按钮
- PushReceipt 改话术,SHA 收到 "查看详情" 折叠区里
- Clone 进度隐藏 git 阶段名,只显示百分比
- 不改任何后端逻辑

### 阶段 2:合并 Sync 语义(中等改动)

- "Sync" 按钮改为 pull + push 双向(条件:本地无未提交 → pull;有 → pull then push)
- 加一个"自动同步"开关(默认开),用 [storage.ts:27](../electron/ipc/storage.ts) 的 `PICG_AUTOPUSH` 改成 UI 可控配置
- 加 debounce 逻辑

### 阶段 3:冲突 UI 与错误话术(高价值,要细做)

- 把 git 报错统一映射到 "需要处理" 状态 + 中文话术
- 做专门的冲突解决界面(可能简化到 "用云端 / 用本地" 二选一)
- 加上 "无法连接" 的全局指示

### 阶段 4:开发者视图(可选)

- 设置里一个开关回到当前的 git-显式 UI
- 保住老用户的预期

---

## 8. 我的判断

如果只能给一句话建议:

> **PicG 应该走 4.X(photo-centric 状态机),分阶段推进,先做阶段 1。**

理由:
- 后端已经把 git 抽象做了 80%,UI 是最后短板
- 当前 "Sync 只做 pull" 是明确的 bug-by-design,改对了顺便能修
- 摄影师用户群对 "我的照片是不是都在云上了" 的关心远大于对 "我现在 ahead 几个 commit" 的关心
- 但**保留开发者视图**很重要,因为早期用户里有相当一批是 GitHub 用户

不推荐:
- 单纯把按钮改名("Sync" → "立即同步")就完事——这是 Abstract 翻译式抽象的坑,既丢了原预期又没改模型
- 一次性大改——风险高,也没办法验证哪一步是对的

---

## 参考资料

- [Dropbox sync icons (macOS)](https://help.dropbox.com/sync/macos-sync-icons)
- [Dropbox sync status](https://help.dropbox.com/sync/check-sync-status)
- [Obsidian Git plugin (auto commit-and-sync)](https://github.com/Vinzent03/obsidian-git)
- [Obsidian Sync vs Obsidian Git 对比](https://blog.thefix.it.com/how-does-obsidian-sync-differ-from-git-the-ultimate-comparison/)
- [GitHub Desktop simplified setup discussion](https://github.com/desktop/desktop/issues/19200)
- [Abstract: Git for designers](https://blog.prototypr.io/git-repository-for-designers-abstract-sketch-9138cf6ab9b1)
- [Abstract vs Kactus vs Plant 对比](https://blog.prototypr.io/abstract-vs-kactus-vs-plant-a-guide-of-version-control-solutions-for-sketch-7da0a8ab5105)
