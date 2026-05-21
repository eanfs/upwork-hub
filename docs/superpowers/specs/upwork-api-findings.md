# Upwork 接口结构 findings

> 来源:2026-05-20 用真实登录会话(Chrome + CDP 附接)访问 `https://www.upwork.com/nx/search/jobs/?q=react%20developer` 并点开一个职位详情,通过 `scripts/observe.ts` 抓取的 GraphQL 响应。原始 captures 在 `captures/2026-05-20T13-33-59-414Z/`,经甄别后的 fixture 保存在:
> - `tests/fixtures/search-response.json`(对应 captures/028.json)
> - `tests/fixtures/job-detail-response.json`(对应 captures/052.json)

---

## 1. 列表接口(搜索列表页)

- **URL 模式:** `https://www.upwork.com/api/graphql/v1?alias=userJobSearch`
- **请求方法:** POST(GraphQL,本次未抓取请求 body;响应体足以覆盖 Normalizer 测试)
- **页面 URL 模式:** `https://www.upwork.com/nx/search/jobs/?q=<encoded keyword>` —— 与现有 `SourceResolver` 实现一致
- **响应根路径:**
  ```
  data.search.universalSearchNuxt.userJobSearchV1
  ```
- **翻页机制:** 响应中 `paging` 字段标识当前页:
  ```json
  { "total": 4908, "offset": 10, "count": 10 }
  ```
  - 第 1 页:`offset = 0`
  - 第 2 页:`offset = 10`
  - …以此类推,**每页 count = 10**
  - 翻页通过 GraphQL `variables` 控制(具体变量名待请求 body 抓取);页面 URL 端可能附带 `&page=2` 参数(本次未观察到,但 Upwork SPA 通常用 URL 同步翻页状态)
- **职位数组路径:** `data.search.universalSearchNuxt.userJobSearchV1.results[]`
- **facets(过滤器选项分布):** `userJobSearchV1.facets`,含 `jobType` / `workload` / `clientHires` / `durationV3` / `amount` / `contractorTier` / `contractToHire` / `paymentVerified` / `proposals` / `previousClients` —— 这些就是 Upwork UI 上的筛选项

---

## 2. 详情接口(职位详情页)

- **URL 模式:** `https://www.upwork.com/api/graphql/v1?alias=gql-query-get-auth-job-details-v2`
- **请求方法:** POST(GraphQL)
- **页面 URL 模式:** `https://www.upwork.com/jobs/~<ciphertext>` —— `ciphertext` 形如 `~022056613090405278864`(`~02` 前缀 + 19 位数字),来自列表响应里每个职位的 `jobTile.job.ciphertext`
- **响应根路径:**
  ```
  data.jobAuthDetails
  ```
- **关键子路径:**
  - `data.jobAuthDetails.opening.job` —— 职位本身的完整数据(描述、类别、技能、预算、雇主活动)
  - `data.jobAuthDetails.buyer` —— 客户信息(`info`、`stats`、`company`、`workHistory`)
  - `data.jobAuthDetails.opening.qualifications` —— 对接案人的要求(国家、语言、JSS、最少时长等)
  - `data.jobAuthDetails.opening.questions` —— 申请时要回答的问题
  - `data.jobAuthDetails.applicantsBidsStats` —— 申请人数 / 投标统计(本次 null,可能登录身份或职位状态相关)

---

## 3. 字段定位表

针对 `docs/superpowers/specs/2026-05-17-upwork-job-collector-design.md` 第 5 节 `jobs` 表的每个字段。"列表"指 `userJobSearchV1.results[i]`,"详情"指 `jobAuthDetails`。

| jobs 字段 | 来源 | JSON 路径(列表) | JSON 路径(详情) | 备注 |
|---|---|---|---|---|
| `id` | 列表 | `results[i].id` 或 `results[i].jobTile.job.id` | `opening.job.info.id` | 字符串型 19 位数字 |
| `url` | 由 `ciphertext` 构造 | `https://www.upwork.com/jobs/~<results[i].jobTile.job.ciphertext>` | 同左,用 `opening.job.info.ciphertext` | 注意 ciphertext 自带 `~02` 前缀 |
| `title` | 列表 | `results[i].title`(或 `jobTile.job.title`,详情里同名) | `opening.job.info.title` | 列表 title 可能含 `H^...^H` 高亮标记,需剥离 |
| `description` | 列表(短)/ 详情(长) | `results[i].description`(短描述,~200 字符,含 `H^高亮^H`) | `opening.job.description`(完整 markdown,可达数千字) | 详情的更可靠 |
| `budgetType` | 列表 | `jobTile.job.jobType` → `'FIXED'` / `'HOURLY'` / `'WEEKLY_RETAINER'` | `opening.job.info.type`(`'FIXED'` / `'HOURLY'`) | 映射:小写化即可 |
| `budgetAmount` | 列表 | `jobTile.job.fixedPriceAmount.amount`(字符串,如 `"400.0"`)| `opening.job.budget.amount`(数字)| FIXED 时才有;字符串→数字 |
| `hourlyMin` | 列表 | `jobTile.job.hourlyBudgetMin`(字符串,如 `"35.0"`)| `opening.job.extendedBudgetInfo.hourlyBudgetMin` | HOURLY 时才有 |
| `hourlyMax` | 列表 | `jobTile.job.hourlyBudgetMax` | `opening.job.extendedBudgetInfo.hourlyBudgetMax` | HOURLY 时才有 |
| `skills` | 列表 | `results[i].ontologySkills[].prefLabel`(字符串数组) | `opening.job.sandsData.additionalSkills[].prefLabel` | 列表的就够用 |
| `category` | **详情**(列表无)| ⚠️ 列表无 | `opening.job.category.name`(如 `"Web Development"`) | 列表只在 facets 里有可选项,无单条所属 |
| `subcategory` | **详情**(列表无)| ⚠️ 列表无 | `opening.job.categoryGroup.name`(如 `"Web, Mobile & Software Dev"`) | 注意 Upwork 把 categoryGroup 当上级,category 当下级 |
| `experienceLevel` | 列表 | `jobTile.job.contractorTier` —— `'EntryLevel'` / `'IntermediateLevel'` / `'ExpertLevel'` | `opening.job.contractorTier` —— `'ENTRY'` / `'INTERMEDIATE'` / `'EXPERT'` | **两边格式不同**!需在 Normalizer 中归一 |
| `projectDuration` | 列表 | FIXED 取 `fixedPriceEngagementDuration.label`,HOURLY 取 `hourlyEngagementDuration.label`(如 `"1 to 3 months"`) | `opening.job.engagementDuration.label` | 详情有统一字段更清爽 |
| `proposalsCount` | 列表 | `jobTile.job.totalApplicants` | `opening.job.clientActivity.totalApplicants` | 整数 |
| `clientCountry` | 列表 | `upworkHistoryData.client.country`(`"USA"`)| `buyer.info.location.country`(`"ARE"` —— **ISO 3166-1 alpha-3**) | **两边格式不同**:列表是 Upwork 习惯写法(USA/UK),详情是 ISO 3 字母码,需归一 |
| `clientTotalSpent` | 列表 | `upworkHistoryData.client.totalSpent.amount`(字符串)| `buyer.stats.totalCharges` | 列表的更直观;详情可能 null |
| `clientHireRate` | ⚠️ 两处都没有直接给 | 需用 `buyer.jobs.openCount` / `postedCount` 推算,或 `buyer.stats.totalJobsWithHires / postedCount`?**待 Phase B 决策** | 同左 | 这一列可能落 null,设计文档允许 |
| `clientRating` | 列表 | `upworkHistoryData.client.totalFeedback`(平均分?待确认)/ `totalReviews`(评价数)| `buyer.stats.score` / `feedbackCount` | 字段语义不一致,需选其一并文档化 |
| `clientPaymentVerified` | 列表 | `upworkHistoryData.client.paymentVerificationStatus === 'VERIFIED'` | `buyer.isPaymentMethodVerified`(布尔)| 详情更明确 |
| `postedAt` | 列表 | `jobTile.job.publishTime`(ISO 字符串) | `opening.job.publishTime` 或 `opening.job.postedOn` | 二者通常接近;`postedOn` 含早一些的草稿创建时间 |

**说明:**
- 列表接口已经携带绝大部分 `jobs` 字段;只有 `category` / `subcategory` 必须靠详情接口补全。
- `clientHireRate` 没有直接字段,需推算或留 null。
- `contractorTier` 两端枚举值不同(`ExpertLevel` vs `EXPERT`),归一化到小写下划线形式(`expert` / `intermediate` / `entry`)。
- `clientCountry` 两端格式不同,需在 Normalizer 中按"列表用国家全称、详情用 ISO 码"分别处理。

---

## 4. 分类筛选 URL 参数

> **2026-05-21 更新:已废弃。** 阶段 B' 把采集改为纯用户驱动的 `watch` 模式后,`SourceResolver` / `CategoryFilter` / `Config.sources.categoryFilters` 全部删除——用户直接在 Chrome 里手动点筛选,无需程序化展开 URL。下面的内容仅作历史记录保留。

**本次未观察到分类筛选点击。** 仅观察到:
- `q=<keyword>` —— 关键词搜索

设计文档里 `CategoryFilter` 设想了 `category` / `budgetMin` / `experienceLevel`。基于 Upwork SPA 通用约定与本次抓到的 facets,**预期**(尚未验证):
- `category2_uid=<uid>` 或 `subcategory2_uid=<uid>` —— 分类用其 ontology UID
- `amount=<min>-<max>` —— 预算范围(facet 名为 `amount`)
- `contractor_tier=2,3` —— 经验等级(2=Intermediate, 3=Expert,按 facet `contractorTier` 推断)
- `t=0,1` —— jobType(0=hourly,1=fixed?)
- `payment_verified=1` —— 仅显示已验证支付的客户

**结论:** 阶段 B 实现 `SourceResolver` 的分类筛选分支时,需先做一次**补充观察**(用真实浏览器操作各个 facet,记录 URL 变化),再补充本文档与实现。**不应基于猜测实现**。

---

## 5. 职位唯一 ID

- 主键字段:`results[i].id` 或 `results[i].jobTile.job.id`(列表),`opening.job.info.id`(详情) —— 三者一致,均为 19 位数字字符串
- **ciphertext**:`~02` 前缀 + 同一 19 位数字,用于构造页面 URL 与详情请求,与 `id` 一一对应
- 与 SQLite `jobs.id` 主键直接对应,无需转换

---

## 6. Phase B 设计影响

1. **NetworkCapture**:对每个新打开的 list 标签 attach `page.on('response')`,匹配 URL 含 `alias=userJobSearch` 与 `alias=gql-query-get-auth-job-details-v2`,响应体读为 JSON 后入队。
2. **Normalizer**:
   - 输入是上述两个根路径下的对象(`userJobSearchV1` 或 `jobAuthDetails`)
   - 输出 `Job` 接口
   - 列表来的 Job 设 `detailFetched=false`;详情来的 Job 把 `detailFetched=true`、`category` / `subcategory` / `description`(完整版)等列表无的字段填上
   - 归一化项:`budgetType` 小写化、`contractorTier` → `experienceLevel` 小写化、`clientCountry` 统一(具体策略到 Phase B 决定)
3. **ListingCollector**:在列表页 attach listener → 翻页(滚动或点击下一页);用 `paging.offset` / `paging.total` 判断终止条件
4. **DetailCollector**:对未 `detailFetched` 的 Job,逐个用 `ciphertext` 拼 URL,程序化 `page.goto` 详情页;若触发 Cloudflare,降级为人工导航 + 只读 dump
5. **SourceResolver 分类筛选分支**:**先补做一次 facet 点击观察任务**,再实现

---

## 7. 已知风险与待办

- ❓ **请求 body 未抓取**:`observe.ts` 只读响应。GraphQL 请求里的 query / variables(尤其是翻页 variable 名)未知。Phase B 若想绕过 Cloudflare 直接发 `fetch('/api/graphql/v1?alias=userJobSearch')`,需先抓请求 body。短期内仍走"在 Chrome 里翻页 → 拦截响应"的稳妥路径。
- ❓ **`applicantsBidsStats` 本次为 null**:可能是冷职位、登录身份限制,或本身字段就罕见。需在更多详情样本里观察。
- ❓ **分类筛选 URL 参数**:见 §4,未观察。
- ❓ **多条详情样本**:本次只抓 1 个详情,字段空值分布(尤其 buyer.workHistory / qualifications.languages)未充分覆盖。Phase B 写 Normalizer 时再补抓 2–3 个。
