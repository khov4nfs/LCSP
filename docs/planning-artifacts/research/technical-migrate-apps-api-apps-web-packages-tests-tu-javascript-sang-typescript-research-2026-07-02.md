---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: []
workflowType: "research"
lastStep: 1
research_type: "technical"
research_topic: "migrate apps/api, apps/web, packages/*, tests/* từ JavaScript sang TypeScript với shared i18n dictionary vi/en và error/message key architecture"
research_goals: "đề xuất migration JS→TS, shared i18n dictionary, backend trả key thay vì hardcoded text, frontend resolve từ dictionary, cấu trúc thư mục, typing strategy và test impact"
user_name: "lcsp-team"
date: "2026-07-02"
web_research_enabled: true
source_verification: true
---

# Research Report: technical

**Date:** 2026-07-02
**Author:** lcsp-team
**Research Type:** technical

---

## Research Overview

[Research overview and methodology will be appended here]

---

## Technical Research Scope Confirmation

**Research Topic:** migrate `apps/api`, `apps/web`, `packages/*`, `tests/*` từ JavaScript sang TypeScript với shared i18n dictionary `vi/en` và error/message key architecture
**Research Goals:** đề xuất migration JS→TS, shared i18n dictionary, backend trả key thay vì hardcoded text, frontend resolve từ dictionary, cấu trúc thư mục, typing strategy và test impact

**Technical Research Scope:**

- Architecture Analysis - design patterns, contracts, package boundaries, system architecture
- Implementation Approaches - migration sequencing, code patterns, TypeScript adoption strategy
- Technology Stack - languages, frameworks, tools, runtime and package layout
- Integration Patterns - backend/frontend contracts, i18n dictionary flow, error key resolution
- Performance Considerations - build speed, typecheck cost, test surface and rollout risk

**Research Methodology:**

- Current web data with rigorous source verification
- Multi-source validation for critical technical claims
- Confidence level framework for uncertain information
- Comprehensive technical coverage with architecture-specific insights

**Scope Confirmed:** 2026-07-02

## Technology Stack Analysis

### Programming Languages

LCSP hiện là một monorepo Node ESM rất nhỏ, root `package.json` đã đặt `"type": "module"`, nên hướng migration phù hợp nhất là giữ nguyên ESM semantics và chuyển dần từng file `.js` sang `.ts` thay vì đổi cả runtime model. Node.js package docs xác nhận `.js` sẽ được hiểu là ES module khi package gần nhất có `"type": "module"`, và khuyến nghị package authors khai báo `type` rõ ràng để tránh ambiguity. Với repo này, điều đó có nghĩa là TypeScript nên bám theo `module: "nodenext"` để đồng bộ với runtime thật của Node thay vì dùng cấu hình module generic.  
_Popular Languages: TypeScript cho web/API/contracts; JavaScript còn lại chỉ nên tồn tại trong giai đoạn chuyển tiếp._  
_Emerging Languages: Node hiện có built-in type stripping cho `.ts`, nhưng đây phù hợp cho script/runtime nhẹ hơn là chiến lược chính để publish package hoặc điều phối monorepo typed._  
_Language Evolution: TypeScript ngày càng hỗ trợ tốt ESM Node workflows; Node docs hiện khuyến nghị TS 5.8+ cùng `module: "nodenext"`, `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax` cho native TS execution._  
_Performance Characteristics: TS thêm compile/typecheck cost, nhưng đổi lại loại bỏ class lỗi contract drift đang hiện hữu giữa `apps/api`, `apps/web` và `packages/contracts`._  
_Source: https://nodejs.org/api/packages.html; https://nodejs.org/api/typescript.html; https://www.typescriptlang.org/tsconfig/_

### Development Frameworks and Libraries

Về framework, repo hiện chưa bootstrap Next.js runtime đầy đủ, nhưng project context xác định `apps/web` retained topology là Next.js và `apps/api` retained topology là NestJS. Với frontend, Next.js docs hiện nói rõ hỗ trợ TypeScript built-in và có thể thêm TS vào project hiện có bằng cách đổi file sang `.ts/.tsx`, chạy `next dev` hoặc `next build` để sinh `tsconfig` khuyến nghị. Điều này phù hợp với chiến lược migration không big-bang cho `apps/web`. Về i18n typing, hai hướng có độ chín tốt là `i18next` và `next-intl`: cả hai đều hỗ trợ derive type trực tiếp từ default locale/messages object. Với yêu cầu của repo này, trọng tâm không phải chọn framework i18n phức tạp mà là chuẩn hóa shared dictionary package và typed message keys dùng được ở cả backend lẫn frontend.  
_Major Frameworks: Next.js có built-in TypeScript support; backend target là NestJS nên cần contract typing trước khi chạm decorator-heavy modules._  
_Micro-frameworks: Nếu frontend mới chỉ là pure module logic như hiện tại, chưa cần khóa chặt vào thư viện i18n runtime; có thể bắt đầu bằng dictionary resolver thuần TypeScript trong `packages/i18n`._  
_Evolution Trends: Typed message catalogs và type augmentation theo default locale đang là pattern phổ biến trong tooling i18n hiện đại._  
_Ecosystem Maturity: `i18next` hỗ trợ `CustomTypeOptions` để type `resources`; `next-intl` hỗ trợ type augmentation cho `Locale` và `Messages` từ file messages thực tế._  
_Source: https://nextjs.org/docs/app/api-reference/config/typescript; https://www.i18next.com/overview/typescript; https://next-intl.dev/docs/workflows/typescript_

### Database and Storage Technologies

Phạm vi migration hiện tại hầu như chưa chạm database runtime thực, nhưng source hiện có cho thấy `apps/api` đang chạy trên in-memory store để mô tả auth/RBAC flows. Vì vậy database không phải nơi rủi ro chính của migration này. Rủi ro chính là model typing cho store records, session records, audit events, membership/policy fixtures và error contracts. TypeScript nên được dùng để khóa shape của in-memory state trước, từ đó mới tách được domain types tái sử dụng nếu sau này đưa vào persistence layer thật.  
_Relational Databases: Chưa có surface hiện hữu trong code cần migrate ở bước này._  
_NoSQL Databases: Không có bằng chứng code hiện tại phụ thuộc NoSQL-specific shapes._  
_In-Memory Databases: `createInMemoryStore()` hiện là locus chính để áp dụng typed entities, discriminated union cho responses, và readonly fixtures._  
_Data Warehousing: Không liên quan trực tiếp đến migration scope hiện tại._  
_Source: repo inspection kết hợp với scope giới hạn của codebase hiện tại; không cần claim web-specific mới cho phần storage vì đây là local architecture assessment._

### Development Tools and Platforms

Cho toolchain, TypeScript docs xác nhận `allowJs` có thể dùng để nhập file JS trong project TS và phù hợp cho incremental adoption; `checkJs` hoạt động cùng `allowJs` để bật error reporting trong JS hiện hữu. Điều này đặc biệt hữu ích cho LCSP vì repo đang có 8 file `.js` và chưa có `tsconfig`: có thể khởi đầu bằng root `tsconfig.base.json` + `allowJs/checkJs`, sau đó đổi extension từng package theo phase. Nếu monorepo lớn lên, TypeScript project references là cơ chế chính thức để chia code thành các project nhỏ hơn, dùng `tsc -b` để build theo dependency order, cải thiện build time và logical separation. Với testing, repo đang dùng `node:test`; giữ nguyên test runner là lựa chọn hợp lý vì không cần tăng thêm test framework churn trong cùng đợt migration.  
_IDE and Editors: VS Code/TS language service hưởng lợi rõ nhất khi contracts, dictionaries và response unions được type hóa._  
_Version Control: Không có yêu cầu thay đổi Git workflow; migration nên được tách thành small PR theo package boundary._  
_Build Systems: `tsc --build` + project references là hướng chuẩn nếu tách `packages/contracts`, `packages/i18n`, `apps/api`, `apps/web`, `tests` thành các TS projects._  
_Testing Frameworks: Giữ `node --test`; chỉ đổi import paths, file extensions, và assertion typing._  
_Source: https://www.typescriptlang.org/tsconfig/; https://www.typescriptlang.org/docs/handbook/project-references.html; https://nodejs.org/api/test.html_

### Cloud Infrastructure and Deployment

Migration này chưa bị dẫn dắt bởi cloud provider cụ thể; constraint lớn hơn là runtime compatibility của Node ESM và output strategy của internal packages. Node docs khuyến nghị dùng `"exports"` cho package entry points mới và cho phép subpath exports khi cần. Điều này quan trọng nếu `packages/contracts` và `packages/i18n` trở thành shared internal packages, vì frontend/backend không nên import sâu vào `src/**` sau migration.  
_Major Cloud Providers: Không ảnh hưởng trực tiếp tới quyết định JS→TS của repo hiện tại._  
_Container Technologies: Không có container-specific blocker trong source hiện tại._  
_Serverless Platforms: Không chi phối thiết kế migration này._  
_CDN and Edge Computing: Chỉ liên quan nếu `apps/web` sau này dùng Next runtime features; chưa phải quyết định trọng tâm bây giờ._  
_Source: https://nodejs.org/api/packages.html_

### Technology Adoption Trends

Pattern được support mạnh nhất bởi nguồn chính thức hiện nay là: giữ ESM rõ ràng, dùng TypeScript incremental adoption thay vì rewrite một lần, và derive i18n typings từ default message resources. Next.js đang đẩy mạnh built-in TS support; Node hiện đã có type stripping stable nhưng vẫn nêu rõ rằng nó không đọc `tsconfig.json` và không hỗ trợ các feature cần transform, nên nó không thay thế `tsc` cho monorepo package architecture. Với LCSP, xu hướng phù hợp là dùng TypeScript làm contract and verification layer, không dựa vào native TS runtime như build strategy chính.  
_Migration Patterns: `allowJs` + `checkJs` cho phase đầu, rồi đổi file `.js` sang `.ts` theo bounded contexts._  
_Emerging Technologies: Typed message catalogs và locale/message augmentation đang là pattern phổ biến, đặc biệt trong Next-oriented stacks._  
_Legacy Technology: Hardcoded copy trong backend/frontend là anti-pattern cần loại bỏ đầu tiên trước khi mở rộng i18n runtime phức tạp._  
_Community Trends: Project references và package `exports` đang là hướng bền vững cho monorepo TS có shared contracts._  
_Source: https://www.typescriptlang.org/tsconfig/; https://www.typescriptlang.org/docs/handbook/project-references.html; https://nextjs.org/docs/app/api-reference/config/typescript; https://nodejs.org/api/typescript.html; https://next-intl.dev/docs/workflows/typescript_

## Integration Patterns Analysis

### API Design Patterns

Đối với LCSP, pattern phù hợp nhất không phải đổi sang GraphQL/gRPC mà là chuẩn hóa REST-style error contract hiện có thành machine-readable envelope với human-readable text được resolve ở edge. RFC 9457 định nghĩa problem details để mang thông tin lỗi machine-readable trong HTTP responses, tránh phải tự phát minh format lỗi mới cho mỗi API. Zalando REST guidelines cũng yêu cầu endpoint hỗ trợ `application/problem+json` cho cả lỗi 4xx và 5xx, và cho phép mở rộng object này bằng custom fields. So với code hiện tại của repo, `createSafeError()` đã gần đúng về intent nhưng còn trộn hai trách nhiệm: contract machine-readable (`error_code`, `required_action`) và localized text (`message`). Hướng tích hợp tốt hơn là backend chỉ trả `type`, `status`, `code/message_key`, `required_action`, `correlationId`, cùng optional metadata an toàn; frontend hoặc API consumer sẽ resolve text bằng dictionary tương ứng locale.  
_RESTful APIs: Dùng RFC 9457 `application/problem+json` làm envelope chuẩn cho HTTP errors; giữ `code` hoặc extension field như application-specific key để frontend map copy._  
_GraphQL APIs: GraphQL spec cũng tách `errors` thành list error maps và cho phép partial data khi có field errors, nhưng không phù hợp scope repo hiện tại vì flow hiện hữu là request/response auth endpoints đơn giản._  
_RPC and gRPC: Không có lợi thế rõ cho migration này vì bài toán chính là typed contracts và localization, không phải binary transport hoặc service mesh scale._  
_Webhook Patterns: Không liên quan trực tiếp ở phạm vi auth/web route hiện tại, nhưng cùng nguyên tắc machine-readable event/error payload vẫn nên áp dụng nếu sau này phát sinh callbacks hoặc events._  
_Source: https://datatracker.ietf.org/doc/html/rfc9457; https://opensource.zalando.com/restful-api-guidelines/; https://spec.graphql.org/October2021/_

### Communication Protocols

Protocol thực tế của migration này vẫn là HTTP/JSON giữa frontend và backend, nhưng contract nên được thiết kế để không phụ thuộc ngôn ngữ hiển thị. RFC 9457 chỉ ra rằng human-readable strings như `title` và `detail` có thể được negotiated qua `Accept-Language`, nhưng guideline an toàn hơn cho monorepo này là dùng locale-independent keys trong payload và chỉ để localized rendering ở frontend. Cách này tránh backend phải biết copy của mọi surface, đồng thời giữ behavior test ổn định giữa `vi` và `en`. Nếu cần backward compatibility, backend có thể tạm trả song song `message_key` và `message` trong một phase chuyển tiếp, nhưng mục tiêu cuối nên là frontend không assert trực tiếp vào backend copy nữa.  
_HTTP/HTTPS Protocols: HTTP JSON vẫn là giao thức chuẩn; thêm `application/problem+json` vào Accept/Content handling nếu sau này API surface thực được expose._  
_WebSocket Protocols: Không liên quan cho current auth/workspace flow._  
_Message Queue Protocols: Không nằm trong phạm vi code hiện tại, nhưng nguyên tắc event payload dùng stable keys thay vì localized text nên được tái dùng cho async domains._  
_grpc and Protocol Buffers: Không phải nhu cầu hiện tại; TS migration và error/i18n consistency là bottleneck thực sự._  
_Source: https://datatracker.ietf.org/doc/html/rfc9457; https://opensource.zalando.com/restful-api-guidelines/_

### Data Formats and Standards

Về data format, JSON vẫn là format đúng cho contract giữa `apps/api` và `apps/web`, nhưng cần phân tách rõ lớp semantic. JSON:API mô tả error objects có thể chứa `type`, `status`, và application-specific `code`; RFC 9457 chuẩn hóa `type`, `title`, `detail`, `status`, `instance` cùng extension members. Từ hai chuẩn này có thể suy ra một shape thực dụng cho LCSP:

- `type`: URI hoặc namespaced string của problem family, ví dụ `auth/invalid-credentials`
- `status`: HTTP status
- `code`: stable application error key, ví dụ `AUTH.INVALID_CREDENTIALS`
- `title_key`: key cho headline UI
- `detail_key`: key cho message body
- `required_action`: stable action key
- `correlationId`: trace/support key
- `meta`: object cho interpolation params an toàn như `{ retry_after_minutes: 15 }`

Điểm quan trọng là `meta` phải chứa data chứ không chứa copy, để formatter phía frontend nội suy theo dictionary locale. Điều này cũng giải quyết vấn đề hiện có trong `apps/web/src/auth-entry.js`, nơi title đang được map theo code còn body lại tin vào `apiResult.message`, khiến copy source bị tách đôi và khó đồng bộ.  
_JSON and XML: JSON là format phù hợp; XML không cần thiết cho monorepo này._  
_Protobuf and MessagePack: Không cần cho auth/web flows hiện tại._  
_CSV and Flat Files: Không liên quan._  
_Custom Data Formats: Có thể dùng internal `AppProblem` type dựa trên RFC 9457 extension members thay vì tự phát minh format hoàn toàn khác._  
_Source: https://datatracker.ietf.org/doc/html/rfc9457; https://jsonapi.org/format/#errors_

### System Interoperability Approaches

Interoperability concern chính của repo này là giữa ba lớp: `packages/contracts`, `apps/api`, `apps/web`. Hiện tại `packages/contracts/src/auth-contracts.js` chứa cả error codes lẫn Vietnamese safe messages, làm package contracts bị lẫn presentation concern. Đề xuất tương thích nhất là tách thành:

- `packages/contracts`: chỉ chứa enums/unions, DTOs, `AppProblem`, `RequiredAction`, request/response contracts
- `packages/i18n`: chứa dictionaries `vi` và `en`, typed message key space, resolver utilities
- `apps/api`: emit `AppProblem` với keys và `meta`
- `apps/web`: map `AppProblem` sang UI view model bằng resolver từ `packages/i18n`

Nếu sau này cần package publish boundary rõ hơn, Node package docs khuyến nghị dùng `"exports"` để expose entry points ổn định, tránh deep import vào `src/**`. Điều này đặc biệt có giá trị cho `packages/contracts` và `packages/i18n`, vì test, web, và api đều nên import từ public entrypoints thay vì đường dẫn nội bộ mong manh như hiện nay.  
_Point-to-Point Integration: Phù hợp với current repo vì web và api giao tiếp trực tiếp qua contract package shared._  
_API Gateway Patterns: Không liên quan trực tiếp trong local codebase, nhưng error envelope đề xuất vẫn tương thích với API gateway/proxy layers._  
_Service Mesh: Không cần ở scope này._  
_Enterprise Service Bus: Không liên quan._  
_Source: https://nodejs.org/api/packages.html; https://www.typescriptlang.org/docs/handbook/project-references.html_

### Microservices Integration Patterns

Mặc dù repo hiện chưa phải microservices mesh, pattern quan trọng cần borrow là contract-first integration. `packages/contracts` nên là single source of truth cho mọi response union, đặc biệt:

- `AuthErrorCode`
- `RequiredAction`
- `Locale`
- `MessageKey`
- `AppProblem<TCode, TMeta>`
- `ApiResult<SuccessPayload, AppProblem>`

Với pattern này, backend không thể emit key không tồn tại trong dictionary contract, và frontend không thể render key chưa được dịch. Nếu muốn tăng độ chặt, `MessageKey` có thể derive trực tiếp từ dictionary base locale và `AppProblem` nhận generic `TMessageKey extends MessageKey`. Đây là điểm mà TypeScript mang lại lợi ích thực tế hơn hẳn JSDoc hoặc string constants rời rạc.  
_API Gateway Pattern: Contract package là gateway logic ở compile-time giữa API và UI._  
_Service Discovery: Không áp dụng._  
_Circuit Breaker Pattern: Không áp dụng cho migration nội bộ này._  
_Saga Pattern: Không phải trọng tâm của auth/web flows hiện tại._  
_Source: https://www.typescriptlang.org/docs/handbook/project-references.html; https://www.i18next.com/overview/typescript; https://next-intl.dev/docs/workflows/typescript_

### Event-Driven Integration

Cho event-driven integration, insight quan trọng không nằm ở RabbitMQ/Kafka cụ thể mà ở payload semantics: event hoặc async failure payload cũng nên mang stable keys, không mang localized prose. Điều này nhất quán với project context về audit/privacy và giúp downstream systems không phải parse human text. Với LCSP, cùng nguyên tắc của `AppProblem` có thể tái dùng cho audit-safe blocked reasons hoặc async processing errors: machine-readable `code`, optional `meta`, và locale resolution chỉ diễn ra ở presentation layer.  
_Publish-Subscribe Patterns: Nếu sau này có auth/security events, payload nên chứa code/key thay vì message text._  
_Event Sourcing: Không liên quan trực tiếp._  
_Message Broker Patterns: Pattern key-based payload phù hợp cả sync lẫn async._  
_CQRS Patterns: Không phải trọng tâm ở scope hiện tại._  
_Source: inference from RFC 9457 + project context; không có yêu cầu transport-specific mới trong code hiện tại._

### Integration Security Patterns

Security-wise, việc bỏ hardcoded text khỏi backend còn có lợi ở chỗ giảm nguy cơ vô tình lộ details không nên đi ra client. Zalando guidelines nhấn mạnh không expose stack traces; project context của LCSP cũng yêu cầu audit-safe, secret-safe outputs. Vì vậy error contract nên phân cấp:

- stable public `code`
- public `message_key` / `title_key`
- public `required_action`
- safe `meta`
- internal-only debug/audit context không serialize ra client

Ngoài ra, `correlationId` hiện có trong repo là điểm mạnh cần giữ. Frontend nên render correlation id ở blocked states khi phù hợp, nhưng không nên dùng nó làm lookup cho copy.  
_OAuth 2.0 and JWT: Không phải phần thay đổi của migration này, nhưng auth errors vẫn nên trả theo stable key contract._  
_API Key Management: Không liên quan._  
_Mutual TLS: Không liên quan._  
_Data Encryption: Không đổi bởi migration này; điểm chính là kiểm soát information disclosure trong error payloads._  
_Source: https://opensource.zalando.com/restful-api-guidelines/; https://datatracker.ietf.org/doc/html/rfc9457_

## Architectural Patterns and Design

### System Architecture Patterns

Pattern kiến trúc phù hợp nhất cho repo hiện tại là modular monorepo với shared packages rõ boundary, không phải big monolith config duy nhất và cũng chưa cần microservices split. TypeScript project references cho phép tách chương trình thành các phần nhỏ hơn, cải thiện build time và enforce logical separation giữa components. Áp vào LCSP, điều này map rất tự nhiên thành `packages/contracts`, `packages/i18n`, `apps/api`, `apps/web`, và `tests` như các TS projects riêng, được build theo dependency order bằng `tsc -b`. Đây là architectural choice quan trọng vì nhu cầu chính của migration không phải đổi behavior nghiệp vụ mà là khóa các ranh giới compile-time giữa contract, presentation copy và application logic.  
_Source: https://www.typescriptlang.org/docs/handbook/project-references.html_

### Design Principles and Best Practices

Best practice cốt lõi cho migration này là contract-first, presentation-late. `packages/contracts` không nên chứa text hiển thị; nó chỉ nên mô tả semantic intent thông qua unions, interfaces và generics. `packages/i18n` mới là nơi giữ dictionaries và resolver logic. TypeScript narrowing docs cho thấy discriminated unions hoạt động tốt khi code phân nhánh bằng stable discriminants; điều này rất phù hợp với `ApiResult` kiểu `{ok: true, ...} | {ok: false, problem: AppProblem}`. Với shape này, cả `apps/api` lẫn `apps/web` đều được compile-time guidance rõ ràng mà không cần check mơ hồ vào field tùy chọn.  
_Source: https://www.typescriptlang.org/docs/handbook/2/narrowing.html; https://www.typescriptlang.org/docs/handbook/project-references.html_

### Scalability and Performance Patterns

Về scalability kỹ thuật, repo hiện nhỏ nhưng architecture nên chọn kiểu tăng trưởng sạch. Project references giúp tăng tốc typechecking và tổ chức code thành group logic rõ ràng; docs cũng nêu caveat rằng composite projects dựa trên generated `.d.ts`, nên solution tốt là có root solution `tsconfig.json` references tới leaf projects và CI chạy `tsc -b`. Với i18n typing, `next-intl` ghi rõ type augmentation cho messages có overhead nhưng nhìn chung hợp lý, và nếu dự án lớn lên có thể tách messages theo package hoặc chỉ bật type-heavy validation trên CI. Suy ra cho LCSP: typed dictionaries là nên có, nhưng cần tránh một message tree khổng lồ duy nhất quá sớm; nên tách namespace theo domain như `auth`, `workspace`, `common`.  
_Source: https://www.typescriptlang.org/docs/handbook/project-references.html; https://next-intl.dev/docs/workflows/typescript_

### Integration and Communication Patterns

Từ góc nhìn kiến trúc tích hợp, repo nên chuyển từ deep relative imports sang package public entrypoints có `exports`. Node package docs khuyến nghị explicit package entry points để định nghĩa interface công khai của package. Khi áp dụng cho LCSP, kiến trúc import nên chuyển từ:

- `../../../packages/contracts/src/auth-contracts.js`

sang các public imports kiểu:

- `@lcsp/contracts/auth`
- `@lcsp/i18n`

Điều này giảm coupling vào layout nội bộ và cho phép refactor package internals mà không phá app/test consumers. Đây cũng là điều kiện cần nếu sau này `apps/web` thực sự chạy dưới Next.js với workspace/tooling chuẩn hơn.  
_Source: https://nodejs.org/api/packages.html_

### Security Architecture Patterns

Security architecture đúng cho scope này là tách public problem contract khỏi internal diagnostic context. Project context của LCSP đã yêu cầu secret-safe, audit-safe outputs; vì vậy architecture nên chia ba tầng:

- `problem public contract`: `code`, `title_key`, `detail_key`, `required_action`, `correlationId`, `meta`
- `server-only diagnostic context`: policy id, evaluator reason, internal stack/debug data
- `audit event payload`: redacted, immutable, domain-safe event records

Thiết kế này giảm khả năng vô tình truyền lẫn debug detail ra client khi migrate sang TS, vì types có thể cấm serialize nhầm object internal vào response public.  
_Source: https://datatracker.ietf.org/doc/html/rfc9457; https://opensource.zalando.com/restful-api-guidelines/_

### Data Architecture Patterns

Data architecture nên dựa trên locale-agnostic semantic data và locale-specific rendering assets. Next.js internationalization guide mô tả locale routing/setup ở framework level, còn `next-intl` và `i18next` đều cho thấy message types có thể derive từ locale resources thực tế. Từ đó, đề xuất data architecture cho LCSP là:

- `packages/i18n/src/locales/en/*.ts`
- `packages/i18n/src/locales/vi/*.ts`
- một `base` locale làm source of truth cho key space
- các locale còn lại phải `satisfies` cùng structure
- message params được encode thành typed `meta`

Nói cách khác, dictionary không phải “string map tự do”, mà là typed data asset có schema compile-time. Điều này đặc biệt quan trọng để tránh drift giữa `title_key`, `detail_key` và interpolation params như `retry_after_minutes`.  
_Source: https://nextjs.org/docs/app/guides/internationalization; https://www.i18next.com/overview/typescript; https://next-intl.dev/docs/workflows/typescript_

### Deployment and Operations Architecture

Về operations, lựa chọn bền vững là thêm typecheck/build layers mà không đổi mạnh runtime pipeline ban đầu. Root solution config có thể orchestration `tsc -b` cho local dev/CI, trong khi apps vẫn chạy trên runtime hiện có. Với package layout nhỏ như hiện tại, không cần build system phức tạp; nhưng nên thiết kế sẵn để mỗi leaf project có `composite`, `declaration`, và `declarationMap` khi cần. Điều này cải thiện editor navigation xuyên package boundaries và giữ migration có thể tách thành nhiều PR nhỏ: `contracts` trước, `i18n` sau, rồi `api`, `web`, `tests`.  
_Source: https://www.typescriptlang.org/docs/handbook/project-references.html_

## Implementation Approaches and Technology Adoption

### Technology Adoption Strategies

Chiến lược adoption phù hợp nhất cho LCSP là incremental migration theo kiểu strangler, không big-bang rewrite. TypeScript handbook mô tả rõ quy trình bắt đầu bằng `allowJs`, tách input/output hợp lý, sau đó đổi từng file `.js` sang `.ts`; Martin Fowler mô tả cùng nguyên tắc ở mức kiến trúc là thay thế dần từng lát nhỏ để giảm rủi ro. Với repo hiện tại chỉ có 8 file `.js`, incremental ở đây không có nghĩa là chậm, mà là giữ rollback đơn giản và cô lập regressions theo package boundary.  
_Source: https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html; https://martinfowler.com/bliki/StranglerFigApplication.html_

### Development Workflows and Tooling

Workflow nên bắt đầu bằng root `tsconfig.base.json` dùng chung, một solution `tsconfig.json` chỉ làm references, rồi leaf `tsconfig.json` cho `packages/contracts`, `packages/i18n`, `apps/api`, `apps/web`, `tests`. Root scripts tối thiểu nên là:

- `typecheck`: `tsc -b`
- `test`: `node --test`
- `test:watch`: `node --test --watch`

Nếu sau này thêm ESLint typed rules, `typescript-eslint` khuyến nghị cẩn trọng với monorepo typed linting để tránh ảnh hưởng tốc độ editor; tốt hơn là để type-aware lint mạnh hơn chạy trên CI thay vì ép toàn bộ local-save workflow.  
_Source: https://www.typescriptlang.org/docs/handbook/project-references.html; https://typescript-eslint.io/troubleshooting/typed-linting/monorepos/_

### Testing and Quality Assurance

Repo hiện dùng `node:test`, và đây là lựa chọn nên giữ để tránh thêm biến số trong cùng đợt migration. Tác động test lớn nhất không nằm ở runner mà ở assertion strategy. Test API hiện đang coupling vào `message` tiếng Việt; sau migration nên chuyển sang assert:

- `problem.code`
- `problem.requiredAction`
- `problem.correlationId`
- `problem.meta` khi có interpolation data

Phần localization nên được kiểm tra bằng resolver/unit tests riêng cho `vi` và `en`, thay vì để API tests assert text localized. Frontend tests nên assert view-model sau khi resolve dictionary, không assert raw payload backend. Ngoài ra nên thêm contract test để đảm bảo mọi `AuthErrorCode` đều map được sang `titleKey/detailKey` hợp lệ ở cả hai locale.  
_Source: https://nodejs.org/api/test.html; https://www.i18next.com/overview/typescript; https://next-intl.dev/docs/workflows/typescript_

### Deployment and Operations Practices

Về deployment, chưa cần đổi runtime pipeline lớn. Trình tự hợp lý là thêm `typecheck` vào CI trước, sau đó mới cân nhắc typed lint. Vì `tsc -b` sẽ build dependencies theo graph references và fail chặt hơn khi có type errors, đây là gate tốt nhất để ngăn contract drift giữa packages và apps. Trong ngắn hạn, runtime có thể vẫn chạy JavaScript output hoặc current Node ESM flow; mục tiêu của migration trước hết là tăng compile-time safety, chưa phải thay cơ chế deploy.  
_Source: https://www.typescriptlang.org/docs/handbook/project-references.html_

### Team Organization and Skills

Kỹ năng quan trọng nhất không phải syntax TypeScript cơ bản mà là discipline ở package boundaries và union-based API design. Nhóm cần thống nhất ba rule:

- backend không trả hardcoded copy
- contracts không chứa presentation text
- locale dictionaries là source of truth cho copy và key structure

Nếu sau này `apps/web` đi sâu vào Next runtime, nhóm frontend cũng nên nắm locale routing và typed messages; còn backend cần quen với generic problem/result contracts và meta-safe serialization.  
_Source: https://nextjs.org/docs/app/guides/internationalization; https://www.typescriptlang.org/docs/handbook/2/narrowing.html_

### Cost Optimization and Resource Management

Đây là migration chi phí thấp nếu giữ scope chặt. Vì repo nhỏ, lợi ích chính đến từ việc giảm logic drift và giảm cost review/debug sau này, không phải từ tối ưu runtime. Cách tối ưu chi phí là:

- không đổi test framework
- không đổi i18n runtime phức tạp ngay từ đầu
- không bật full strictness ngay ngày đầu
- migrate theo package order để tránh sửa qua lại nhiều lần

Điểm tốn kém nhất nếu làm sai sẽ là rewrite copy assertions và import paths quá rộng cùng lúc.  
_Source: synthesis from TypeScript migration guidance + repo scope assessment._

### Risk Assessment and Mitigation

Rủi ro kỹ thuật chính:

- drift giữa `AuthErrorCode` và dictionary keys
- deep import churn khi đổi sang package exports
- test failures do đang assert trực tiếp vào tiếng Việt backend
- strictness rollout quá sớm gây nghẽn migration

Mitigation phù hợp:

- migrate `packages/contracts` trước để khóa public shapes
- tạo `packages/i18n` sớm và derive `MessageKey` từ locale base
- giữ transitional payload nếu cần: `message_key` song song `message` trong một phase ngắn
- thêm contract completeness tests cho locale coverage
- chỉ tăng strictness mạnh sau khi rename file và contract flow đã ổn

_Source: https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html; https://martinfowler.com/bliki/StranglerFigApplication.html_

## Technical Research Recommendations

### Implementation Roadmap

Lộ trình triển khai đề xuất:

1. Thêm `tsconfig.base.json`, solution `tsconfig.json`, `allowJs`, `checkJs`, `module: "nodenext"`.
2. Migrate `packages/contracts` sang TypeScript và tách hẳn safe messages khỏi contract package.
3. Tạo `packages/i18n` với dictionaries `vi/en`, resolver, locale types, message key types.
4. Migrate `apps/api` để emit `AppProblem` typed với `code`, `titleKey`, `detailKey`, `requiredAction`, `meta`.
5. Migrate `apps/web` để resolve `AppProblem` thành localized view-model, bỏ hardcoded title/body maps.
6. Migrate `tests` sang assert contract semantics và localization resolver outputs.
7. Sau khi green, tăng dần strictness: `noImplicitAny`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`.

### Technology Stack Recommendations

- Giữ Node ESM hiện tại.
- Dùng TypeScript `module: "nodenext"` và project references.
- Giữ `node:test`.
- Dùng shared internal packages với `exports`.
- Bắt đầu i18n bằng resolver thuần TypeScript; chỉ thêm framework-specific runtime khi `apps/web` thực sự cần.

### Skill Development Requirements

- TypeScript unions, generics, `satisfies`, template-literal/key derivation
- package boundary design và public entrypoints
- localized message design với interpolation-safe metadata
- CI discipline quanh `tsc -b`

### Success Metrics and KPIs

- 100% file trong `apps/api`, `apps/web`, `packages/*`, `tests/*` chuyển sang `.ts` hoặc `.tsx`
- 0 hardcoded user-facing error/message copy trong backend contracts
- 100% `AuthErrorCode` có dictionary coverage ở cả `vi` và `en`
- test suite pass với assertions semantic-first thay vì copy-first
- CI có `tsc -b` pass ổn định trước merge

## Executive Summary

LCSP nên thực hiện migration JavaScript sang TypeScript theo hướng incremental, contract-first và locale-aware, thay vì rewrite đồng loạt. Kiến trúc đúng cho repo hiện tại là modular monorepo với `packages/contracts` làm semantic boundary, `packages/i18n` làm presentation boundary, và `apps/api` cùng `apps/web` chỉ tiêu thụ các boundary này qua public entrypoints typed.

Thay đổi quan trọng nhất không phải rename `.js` sang `.ts`, mà là đổi flow dữ liệu: backend trả stable problem keys và metadata an toàn; frontend resolve message từ dictionary `vi/en`; tests xác nhận semantics thay vì phụ thuộc vào copy tiếng Việt hardcoded. Nếu làm theo thứ tự `contracts -> i18n -> api -> web -> tests`, migration này có rủi ro thấp, rollback dễ và tạo nền tốt cho retained Next.js/NestJS topology của LCSP.

<!-- Content will be appended sequentially through research workflow steps -->
