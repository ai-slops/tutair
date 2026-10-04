# AI Tutor — Phase 1 Implementation Specification

이 문서는 사용자가 제공한 원래 명세의 **0~69절 요구사항을 같은 번호로 정리한 보존본**이다.
문장과 예시는 축약했으며, 원문 전체를 그대로 복사한 문서는 아니다. 구현 상태를 설명하는 문서와
요구사항을 구분한다. 아래 모델의 필드명은 원래 설계의 개념적 계약이며 현재 HTTP/SQL 이름과
반드시 같지는 않다. 미구현 항목을 현재 구현에 맞추어 삭제하거나 완료로 간주하지 않는다.

- 현재 구현과 차이, 근거, 다음 작업: [구현 현황](phase-one-status.md)
- 핵심 수용 계약: [acceptance contract](phase-one-contract.md)
- 실제 요청/응답: [Backend API](backend-api.md)
- 실행 검증 이력: [verification](verification.md)

## 0. 문서 목적

큰 사전 구축 도메인 DB 없이 실용적으로 사용할 수 있는 AI 튜터를 만든다.
모든 학습 대화·이벤트를 보존하고, 개별 지식 단위의 학습자 상태를 추적한다.
LLM은 당장 필요한 최소 임시 지식 구조를 생성한다. 설명에 사용되는 핵심 전제를 확인하고,
질문·프로젝트·관심사에서 시작하는 자율 학습을 지원한다. 정식 지식 DB는 선택 사항이며,
임시 지식과 원본 학습 증거는 이후 정식 지식에 비추어 재평가할 수 있게 보존한다.
자동 클러스터링, 편집자 검토, 외부 기여는 Phase 2이다.

## 1. 시스템 목표

- 원본 상호작용을 보존한다. 요약은 검색용 파생 데이터이며 원본을 대체하지 않는다.
- 단순 `known: boolean` 대신 무엇을 어떤 의미로, 어느 수행 차원에서 아는지와 판단 근거를 제공한다.
- 정식 DB가 없어도 목표, 지식 단위, 용어 의미, 선수지식, 명제, 오개념, 평가 단위와 최소 그래프를 추출한다.
- `FSM은 이산적이고 형식적인 모델이다`에서 FSM/이산적/형식적/모델을 구분한다.
  중요도와 방해 비용에 따라 그대로 진행, 쉬운 표현, inline 정의, 예시, 진단, 보류 중 선택한다.
- 질문, 프로젝트, 코드, 버그, 문서, 논문, 검증할 주장, 만들고 싶은 것, 호기심, 커리큘럼 모두 진입점이다.
  선수지식을 전부 공부한 뒤 원래 목표로 돌아오도록 강요하지 않는다.

## 2. 비목표

완성된 범용 온톨로지, 자동 지식 병합·정식화, 외부 기여 검토, 기관 간 분산 패키지,
공개 지식 배포, BKT/DKT/AKT, 자동 학술 사실 검증, 시험 중심 커리큘럼 엔진,
게임화/XP/streak, 습관 알림, 고도화된 spaced repetition, 장기 관심사 추천은 구현하지 않는다.
저장 형식은 향후 확장과 재처리를 허용해야 한다.

## 3. 설계 원칙

1. `Conversation / Assessment / Execution → Evidence → Learner State Projection`.
   상태는 추론이며 원본 증거로 재생성 가능해야 한다.
2. 튜터 설명은 exposure이지 학습자의 explanation 능력 증거가 아니다.
3. LLM 지식은 사용할 수 있지만 provisional이며 canonical으로 묵시 승격하지 않는다.
4. 생성 당시 정의의 snapshot 또는 immutable revision을 보존한다.
5. 현재 목표를 우선하고 부족한 선수지식은 가능한 한 scaffolding으로 보완한다.
6. Planner, Response Generator, Knowledge Extractor, Evidence Evaluator, Prerequisite Linter는
   같은 모델을 쓰더라도 독립 호출이며 각각 schema와 버전이 있어야 한다.

## 4. 전체 아키텍처

```text
Learner input → Conversation log → Turn context resolver
  + canonical knowledge + provisional knowledge + learner state
→ Tutor planner → draft → concept linter → revised response → learner
→ evidence evaluator → learning evidence → learner state projection
```

## 5. 주요 도메인 객체

Conversation, Message, LearningThread, KnowledgeUnit, KnowledgeRelation,
ProvisionalKnowledgeRevision, CanonicalKnowledgeRevision, LearningEvidence,
LearnerKnowledgeState, TutorPlan, AssessmentOpportunity, ModelRun.

## 6. Knowledge Unit 종류

`term_sense`(맥락별 용어 의미), `concept`(개념), `claim`(참·거짓/범위가 있는 명제),
`procedure`(단계적 방법), `skill`(일반화 가능한 수행), `distinction`(개념 구분),
`misconception`(대표 오개념). 단어 목록만 저장하는 모델이 아니다.
예: 기술적 “형식적”과 일상적 “격식을 차린”은 서로 다른 의미 단위이다.

## 7. KnowledgeUnit 데이터 모델

`id`, `authority: canonical | provisional`, `kind`, `label`, `aliases[]`,
`currentRevisionId`, `createdAt`, `updatedAt`. 변경 가능한 unit row에 정의를 덮어쓰지 않는다.

## 8. KnowledgeRevision

- `id`, `knowledgeUnitId`, `shortDefinition`.
- `scope`: 선택적인 `domain`, `context`, `audienceLevel`, `inclusions[]`, `exclusions[]`.
- `distinguishingFeatures[]`, 선택적인 `claims[{ text, status }]`.
  claim status는 `model_generated | source_supported | reviewed`.
- `sourceRefs[]`, `createdAt`.
- `origin`: canonical이면 선택적 editor, llm이면 conversationId/sourceMessageIds/modelRunId,
  user이면 conversationId/sourceMessageIds.

revision은 immutable이며 내용이 바뀌면 새 revision을 만든다.

## 9. KnowledgeRelation

`id`, `fromKnowledgeUnitId`, `toKnowledgeUnitId`, `type`, `authority`,
`sourceRevisionIds[]`, `createdAt`, 선택적 metadata를 가진다.
유형은 `prerequisite_of | is_a | part_of | entails | contrasts_with |
often_confused_with | example_of | related_to`.
metadata는 `necessity: hard | soft | contextual | recommended`, `scaffoldable`을 포함할 수 있다.

## 10. Provisional Knowledge

정식 항목이 없거나, 기존 임시 항목과 동등성이 불확실하거나, 의미 범위가 다르거나,
답변에 새로운 핵심 개념이 나타나면 생성한다. 현재 목표 해결에 필요한 만큼만 생성한다.
“FSM이 뭐야?”에는 FSM/state/transition/event/finite/formal model 정도이지 오토마타 전체가 아니다.

## 11. Provisional Knowledge Resolution

canonical exact → canonical semantic → existing provisional → LLM equivalence 판단.
충분히 동등하면 재사용하고 불확실하면 새 provisional을 만든다.
false merge보다 중복이 낫다. 임베딩 유사도만으로 동일성을 결정하지 않는다.

## 12. 학습자 지식 상태 차원

`recognition` 알아보기, `recall` 도움 없이 떠올리기, `explanation` 자기 말로 설명,
`application` 익숙한 문제 적용, `discrimination` 유사 개념·오개념 구분,
`transfer` 새로운 맥락 적용. Phase 1의 fluency는 생략 가능하다.

## 13. LearningEvidence

- id, learnerId, knowledgeUnitId, **knowledgeRevisionId**, dimension.
- observation: conversationId, 선택적인 messageId/assessmentId.
- evaluator: `llm | rule | test_runner | human`, 선택적인 modelRunId/rubricVersion.
- score, evaluatorConfidence, `polarity: positive | negative | ambiguous`.
- assistance: hints, answerVisible, openBook, copiedFromRecentContext.
- context: 선택적 learningThreadId/difficulty, relatedKnowledgeUnitIds[].
- evidenceType: `self_report | recognition_response | free_explanation | application |
  contrast | prediction | artifact | execution_result`, createdAt.

## 14. 증거 해석 원칙

자기보고는 매우 약하고, 객관식 recognition은 약하며, 자기 말로 정의는 중간~강함,
반례·구분·실제 적용은 강하고 새 맥락 적용은 매우 강한 증거로 본다.
직전 튜터의 문장을 거의 반복하면 copiedFromRecentContext를 추정해 크게 할인한다.

## 15. LearnerKnowledgeState

learnerId, knowledgeUnitId, dimensions, evidenceIds[], updatedAt, projectionVersion.
각 dimension은 estimate, uncertainty, `status: unknown | exposed | tentative | supported | stale`,
effectiveEvidence, 선택적 lastObservedAt을 가진다. 독립적인 source of truth가 아니다.

## 16. Phase 1 상태 계산

```text
weight = evidenceTypeWeight × evaluatorConfidence × assistanceDiscount
       × copyingDiscount × contextDiscount
positive = Σ(weight × score)
negative = Σ(weight × (1 - score))
estimate = (priorPositive + positive)
         / (priorPositive + priorNegative + positive + negative)
```

예시 가중치는 self_report 0.2, recognition_response 0.4, free_explanation 0.8,
contrast 0.9, application 1.0, transfer 1.2. 정확한 확률 calibration보다 해석 가능성을 우선한다.
증거 종류 차등, 도움·복사 할인, evidence 추적과 재생성이 필수이다.

## 17. Exposed 상태

설명했지만 능력을 확인하지 않은 경우 recognition.status를 exposed로 기록한다.
KnowledgeExposure는 learnerId, knowledgeUnitId, knowledgeRevisionId, conversationId,
messageId, createdAt을 가진다. mastery evidence와 혼합하지 않는다.

## 18. LearningThread

- id, learnerId, title, createdAt, updatedAt.
- origin: `question | project | problem | resource | curriculum | recommendation`.
- 선택적인 whyNow, desiredOutcome; targetKnowledgeUnitIds[].
- openQuestions: `{ id, text, status: open | resolved | parked }[]`.
- deferredKnowledgeUnitIds[]; status: `active | parked | resolved | abandoned`.

conversation 하나에 여러 thread, thread 하나에 여러 conversation이 가능해야 한다.

## 19. Turn Context Resolver

최근 대화 + 현재 thread/open question + 목표 단위/선수지식 + 상태/중요 evidence 요약 +
관련 canonical/provisional + 필요한 과거 검색 결과만 넣는다. 매 턴 전체 대화를 넣지 않는다.

## 20. 대화 검색

full-text + embedding semantic hybrid retrieval. 대상은 message, thread, knowledge unit, evidence.
가능하면 관련 KnowledgeUnit ID로 query expansion한다. 단순 표면 문장 유사도에 한정하지 않는다.

## 21. Tutor Planner

자연어 전에 구조화한 TutorPlan을 만든다. currentIntent는
`answer | teach | diagnose | practice | apply | review | explore`.
currentGoal, target/assumed/introduce/deferKnowledgeUnitIds[], responseStrategy,
shouldAskBeforeProceeding을 보존한다. assessmentOpportunities는 knowledgeUnitId, dimension,
priority, `preferredMethod: natural_question | contrast | application | none`을 가진다.

## 22. Planner 기본 정책

사용자의 질문을 먼저 해결하고 최소 진단만 한다. centrality·uncertainty·오해 비용이 높고
interrupt cost를 감당할 수 있을 때만 즉시 확인한다. scaffoldable prerequisite는 gate가 아니다.
전이 함수의 형식적 설명이 unknown이어도 전이표를 이용한 FSM application은 진행 가능하다.

## 23. Prerequisite / Concept Linter

draft, planned targets, learner states, known units를 입력으로 받는다.
각 detectedConcept에는 knowledgeUnitId 또는 generatedCandidate(label/shortDefinition),
centrality, learnerUncertainty, misunderstandingCost와
`allow | simplify | define_inline | give_example | diagnose | defer` action을 출력한다.

## 24. Concept Linter 역할

초안에서 실제로 쓰인 개념을 검사한다. 예를 들어 FSM은 목표 개념이므로 설명하고,
formal이 핵심 unknown이면 inline 정의, discrete/model이 supported이면 그대로 사용한다.
모든 unknown마다 질문하지 않는다.

## 25. Response Generator

user message, TutorPlan, resolved knowledge, state summary, lint result, recent conversation을 받는다.
canonical 의미를 우선 제약으로 쓰고 provisional도 사용한다. unknown을 known으로 가정하거나,
설명을 mastery로 기록하거나, 목표를 불필요하게 중단하거나, 과도한 시험을 하지 않는다.

## 26. Assessment Opportunity

모든 턴이 시험은 아니다. 자연스러운 답변에서 증거를 평가한다.
“같은 전이표를 TypeScript와 Rust로 구현해도 같은 FSM인 이유”는 formal model/explanation과
model-vs-implementation/discrimination을 동시에 평가할 기회가 될 수 있다.

## 27. Evidence Evaluator

observations는 unit/revision, dimension, score/confidence, evidenceType,
supportingSpans[], limitations[], copiedFromRecentContext를 출력한다.
unresolvedAmbiguities[]와 선택적인 suggestedFollowup(unit/dimension/method)을 보존한다.

## 28. 평가 원칙

“몇 % 이해했나?”가 아니라 “이 답변이 어떤 단위의 어떤 차원에 어떤 증거를 제공하나?”를 묻는다.
evaluator는 observation을 만들고 상태 계산은 projection layer가 담당한다.

## 29. 정식 지식과 임시 지식

canonical → compatible provisional → new provisional 순으로 조회한다.
정식 데이터는 의미와 평가 기준을 제공하되 실제 설명은 개인화할 수 있다.

## 30. Canonical Knowledge Phase 1

DB가 비어 있어도 되고 관리 UI는 필수가 아니다. Unit/Revision/Relation을 수동 입력할 수 있어야 한다.
YAML import 정도면 충분하다. FSM 및 state 간 선수 관계 같은 최소 데이터부터 시작한다.

## 31. 원본 대화 이벤트

Message는 id, conversationId, `role: learner | tutor | system`, content, createdAt,
선택적인 editedAt/parentMessageId를 가진다. 일반 삭제는 tombstone 또는 MessageDeleted 이벤트.
개인정보 삭제는 실제 삭제와 파생 데이터 무효화를 수행할 수 있어야 한다.

## 32. Event Log

엄격한 전체 event sourcing은 필수가 아니다. 최소 MessageAdded/Edited/Deleted,
LearningThreadCreated/Updated, KnowledgeRevisionCreated, KnowledgeExposureRecorded,
LearningEvidenceRecorded, LearnerCorrectionRecorded, ModelRunRecorded를 immutable하게 보존한다.
LearnerKnowledgeState는 event가 아니라 projection이다.

## 33. ModelRun

id, purpose, provider, model, promptVersion, schemaVersion, inputHash, structuredOutput, createdAt.
purpose는 knowledge_extraction/resolution, tutor_planning, concept_lint,
response_generation, evidence_evaluation. 구조화된 판단을 남기고 내부 chain-of-thought는 저장하지 않는다.

## 34. 데이터베이스

PostgreSQL 권장, pgvector 선택. SQLite도 동일한 책임 구조로 가능하다.
다중 사용자 서버를 예상하면 PostgreSQL부터 시작하는 편이 단순할 수 있다.

## 35. 권장 테이블

users, conversations, messages, learning_threads, learning_thread_questions,
knowledge_units/revisions/relations, knowledge_exposures, learning_evidence,
learner_knowledge_state, model_runs, embedding_documents.
Phase 2 후보: knowledge_candidates/clusters, editorial_reviews, personal_knowledge_items, interests.

## 36. 검색 인덱스

message content, revision definition, unit label/aliases, thread title/desiredOutcome에 full-text index.
embedding은 별도 파생 데이터이고 embedding model 변경 시 재생성할 수 있어야 한다.

## 37. 한 턴의 전체 처리 흐름

1. 원본 learner message와 MessageAdded 저장.
2. thread 계속/기존 thread 전환/새 thread 생성 결정. 불명확하면 새 thread를 남발하지 않는다.
3. 현재 goal/desiredOutcome/mode 추출.
4. targets/prerequisites/terms/claims/distinctions/misconceptions 최소 micrograph.
5. canonical/existing provisional/new provisional로 resolve.
6. 핵심 unit의 learner state 조회.
7. TutorPlan 생성.
8. 응답 초안 생성.
9. 실제 초안 concept lint, 필요 시 새로운 provisional 생성.
10. simplify/inline definition/example/diagnostic/defer 반영.
11. tutor response와 MessageAdded 저장.
12. 실질적으로 설명한 unit의 exposure 저장.
13. 이후 학습자의 관련 답변 또는 자발적 설명을 독립 evaluator로 평가.
14. 원본 메시지와 정확한 revision에 evidence 연결.
15. learner state projection 갱신.

## 38. 대화 재개

현재 질문 → unit resolve → 관련 state → 최근 강한 evidence → unresolved thread → 필요한 과거 message.
이전 conversation 전체를 단순 삽입하지 않는다.

## 39. 지식 revision과 과거 evidence

evidence는 unit ID와 exact revision ID 둘 다 참조한다.
정의가 바뀌어도 당시 평가 대상을 보존하고 과거 evidence를 새 revision으로 자동 이전하지 않는다.
재평가·migration은 Phase 2에서 확장한다.

## 40. 학습자 정정

“이미 안다”, “다른 의미였다”, “우연히 맞혔다”, “잘 모르겠다”를 구조화한다.
LearnerCorrection은 id, learnerId, target(knowledge_state/unit 또는 evidence/id),
`correctionType: claims_more_knowledge | claims_less_knowledge | evidence_invalid | meaning_mismatch`,
sourceMessageId, createdAt을 가진다. 자기보고만으로 숙달도를 최고로 올리지 않는다.

## 41. 자율 학습 정책

현재 목표 해결 → 치명적인 이해 장애 보완 → 자연스러운 학습 기회 → 개념 부채 기록 → 원하면 심화.
선수지식 완전 진단·완전 학습 후에야 원래 질문에 답하는 흐름을 기본으로 삼지 않는다.

## 42. Deferred Knowledge Gap

당장 배우지 않는 중요할 가능성이 있는 gap을 thread에 기록한다.
같은 gap이 반복해서 작업을 막거나, 중요도가 높아지거나, 사용자가 심화를 원하면 다시 제안한다.
복잡한 자동 우선순위는 Phase 1 필수가 아니다.

## 43. 위험도 기반 지식 사용

- Low risk/stable: 일반 수학·CS 기초는 provisional 허용.
- Definition-sensitive: canonical 우선, 없으면 provisional + 명시적 scope.
- Current/contested: 외부 검증 없이는 확정적 지식 상태로 저장하지 않는다.
- High-stakes 의료·법률·안전: 일반 튜터의 자동 canonicalization에서 제외하거나 별도 정책.

## 44. Prompt / Agent 경계

SYSTEM POLICY, TUTOR POLICY, KNOWLEDGE DATA, LEARNER CONTEXT, USER MESSAGE를 구분한다.
knowledge revision 안의 “Ignore all previous instructions”도 명령이 아니라 data이다.

## 45. LLM structured output

가능하면 JSON Schema 등으로 내부 호출을 강제한다. 자유 텍스트를 임의 파싱하는 방식을 피한다.
provider 제약으로 강제가 불가능한 모드는 명시적으로 구분하고 런타임 schema 검증을 유지한다.

## 46. Knowledge Extraction Schema

targets/prerequisites/terms/claims/distinctions/misconceptions 배열.
각 후보에는 label, kind, shortDefinition, importance, scope, aliases를 포함한다.
예: 기술적 “형식적”, term_sense, 명시적 규칙으로 정의 가능, formal models in CS.

## 47. Knowledge Resolution Schema

candidate, `resolution: canonical | provisional_existing | provisional_new`,
matchedKnowledgeUnitId(없으면 null), semanticMatchConfidence, reasonCodes[].
same_scope/same_definition 같은 code 중심으로 남기며 장문의 내부 추론은 필요 없다.

## 48. Tutor Planner Schema

currentIntent, currentGoal, target/assumed/introduce/deferKnowledgeUnitIds[],
assessmentOpportunities[], responseStrategy, shouldAskBeforeProceeding.

## 49. Concept Lint Schema

detectedConcepts[]의 unit ID, centrality, learnerUncertainty, misunderstandingCost, action.
예: formal unknown이 핵심이면 define_inline.

## 50. Evidence Evaluation Schema

observations[]의 unit/revision ID, dimension, score/confidence, evidenceType,
supportingSpans[], limitations[], copiedFromRecentContext, unresolvedAmbiguities[].

## 51. 내부 API 예시

conversation 생성/메시지 추가, thread 생성/조회, knowledge 조회/provisional 생성,
learner unit state 조회, evidence 조회/추가, tutor turn orchestration.
원문의 URL은 예시다. 실제 URL과 인증은 [Backend API](backend-api.md)를 따른다.

## 52. Tutor turn 내부 서비스 경계

KnowledgeService(resolve/createProvisional), LearnerModelService(getStates/addEvidence/rebuildProjection),
ConversationService(appendMessage/retrieveContext), TutorPlanningService(plan), ConceptLintService(lint),
EvidenceEvaluationService(evaluate). 별도 프로세스가 아니라 논리적 책임 분리가 목적이다.

## 53. 추천 코드 구조

domain(conversation/knowledge/learner-model/thread/evidence),
application(tutor-turn/resolution/projection/retrieval), llm(extractor/resolver/planner/linter/evaluator),
infrastructure(postgres/embeddings/provider), api. 디렉터리 이름보다 책임 분리를 우선한다.

## 54. 동기/비동기 처리

메시지 저장, 필요한 knowledge resolution/state retrieval/planning/lint/generation은 동기 경로이다.
embedding, 장기 요약, 추가 추출, 인덱스 갱신, 후보 통계는 비동기 가능하다.
다음 답변에 필요한 learner evidence 평가는 동기 수행한다.

## 55. 실패 처리

extraction 실패 시 일반 LLM 답변 + knowledge tracking skipped marker.
resolution 불확실 시 new provisional. 평가 불확실 시 ambiguous + 낮은 confidence로 영향 제한.
linter 실패 시 답변 가능하되 lintSkipped 기록. provider 장애를 가짜 AI 답변으로 숨기지 않는다.

## 56. Observability

turn trace ID, conversation/message/thread IDs, resolved knowledge IDs,
learner-state snapshot IDs, planner/lint/response/evaluator model runs, latency,
token usage, failure/fallback을 추적한다.

## 57. Privacy

conversation, learner state, evidence는 private. provisional의 conversation provenance는 내부 연결이다.
기본값은 learner-local provisional. 공유한다면 semantic structure만 공유하고 원본은 비공개이며,
다중 사용자 공유 정책은 Phase 2 전에 별도 설계해야 한다.

## 58. 개인 지식 베이스

Phase 1 필수가 아니다. thread, unit, resolved questions, learner explanations/examples,
evidence, conversation source에서 생성 가능한 사용자 편집 artifact로 추가한다.
별도 source of truth가 아니다.

## 59. 테스트 전략

projection: 강한 positive 상승, negative 하락, self-report 작은 변화, hint/copy 할인.
resolution: exact canonical 우선, 같은 provisional 재사용, 불확실한 유사 항목 신규 생성.
revision: 변경 후에도 old evidence는 old revision 참조.

## 60. 필수 End-to-End 테스트

| ID | 시나리오와 기대 결과 |
| --- | --- |
| E2E-1 | canonical 0개에서 질문 → provisional/plan/reply/exposure 생성. |
| E2E-2 | 튜터 설명 → exposure만 증가, learner evidence/explanation mastery 불변. |
| E2E-3 | ceremonial formal과 formally specified는 별도 unit. |
| E2E-4 | 핵심 unknown formal을 linter가 감지하고 inline 정의 또는 진단. |
| E2E-5 | 부수적 unknown마다 진단해 현재 학습을 중단하지 않음. |
| E2E-6 | 직전 설명 반복 → copiedFromRecentContext + 강한 할인. |
| E2E-7 | 명시적 quiz 없이 자발적 정확한 설명도 evidence 생성. |
| E2E-8 | React reducer를 FSM으로 재구성 → FSM/state/transition application만 반영; formal-system explanation 자동 상승 금지. |
| E2E-9 | 몇 주 후 FSM 재개 → 관련 thread/state 검색; 전체 대화 dump 금지. |
| E2E-10 | provisional 정의 수정 → 새 revision; 기존 evidence의 revision 불변. |

## 61. 품질 지표

- Tracking: extraction precision, provisional duplicate rate, incorrect merge rate, evaluator agreement.
- Tutoring: unnecessary diagnostic rate, missed prerequisite rate, user correction rate, abandonment rate.
- Learner model: 미래 답변 정답 예측, state calibration, contradictory evidence frequency.

초기에는 정밀 calibration보다 사용자 정정과 명백한 오판을 우선한다.
관측 데이터가 없으면 수치를 꾸며내지 않는다.

## 62. Phase 1 완료 조건

A 신규 주제에서 임시 micrograph → 상태 → 설명 → 자연스러운 확인 → evidence → 상태 갱신.
B 몇 주 후 provisional과 evidence 재활용.
C 같은 표면어의 다른 의미 분리.
D 선수지식 완전 학습을 강요하지 않고 프로젝트 진행 + 최소 scaffold.
E 튜터가 새 개념 10개를 사용해도 mastery 자동 증가 없음.
실제 동작이 완료 기준이지 테이블·인터페이스의 존재만으로 완료하지 않는다.

## 63. 구현 순서

| Milestone | 범위와 결과 |
| --- | --- |
| 1 저장 기반 | conversation/message/thread/unit/revision/relation/evidence/state/model-run 생성·조회·revision·trace. |
| 2 Provisional | extractor/resolver/creation으로 canonical 없이 최소 micrograph. |
| 3 Learner model | evaluator/persistence/projection/exposure로 실증과 노출 분리. |
| 4 Planning | context resolver/planner로 목표·지식·상태를 고려한 계획. |
| 5 Linter | draft concepts/state/action/revision으로 중요한 미확인 전제 감소. |
| 6 Longitudinal | hybrid retrieval/thread resume/cross-session state. |

## 64. Phase 1에서 단순하게 둘 것

weighted aggregation은 교체 가능한 인터페이스만 둔다. 그래프 DB 대신 adjacency table.
embedding은 검색 보조이지 identity/truth의 원본이 아니다. curriculum은 thread origin 중 하나.
interest model은 만들지 않고 whyNow/desiredOutcome/origin을 축적한다. personal KB는 만들지 않는다.

## 65. Phase 2를 위해 반드시 남길 데이터

provisional revision/origin, source conversation/message IDs, model-run ID, resolution decision,
learner evidence 원본과 exact revision ID, correction, exposure, LearningThread.
이것으로 clustering, 공통 오개념 추출, 후보 생성, canonical mapping, evidence 재평가가 가능해야 한다.

## 66. 핵심 invariant

1. No learner mastery without learner evidence.
2. Every evidence points to the exact knowledge revision it evaluated.
3. Provisional may be used for tutoring, never silently treated as canonical.
4. Learner state is reconstructable from evidence.
5. Unknown prerequisite does not automatically block the current goal.
6. Semantic uncertainty prefers duplication over destructive merging.
7. Raw conversation is the evidence source; summaries/embeddings are disposable projections.

## 67. 전체 동작 예시

“React 상태 관리에 FSM을 쓰면 뭐가 좋아?” → FSM/state/event/transition/invalid-state/formal-model 추출.
state가 supported이면 가정하고 transition은 소개하며 formal-model은 보류한다.
전이는 이벤트에 따른 상태 이동으로 inline 정의하고, 모순된 boolean 상태 조합을 방지하는 이점을 설명한다.
FSM/transition/invalid-state prevention exposure만 저장한다.
학습자가 “loading이면서 success인 상태를 아예 표현 못 하게 한다는 거네”라고 답하면
FSM/application 0.72, invalid-state prevention/explanation 0.90, state/application 0.82 같은
관측이 가능하다. 이 수치는 예시이며 formal-model evidence는 생기지 않는다.

## 68. 구현 시작 체크리스트

unit/revision 분리, canonical/provisional 구분, evidence exact revision,
state projection, exposure/evidence 분리, curriculum보다 상위인 thread,
호출별 structured schema와 ModelRun, 불확실한 resolution은 신규 provisional,
자연어 전 TutorPlan, draft 후 lint, 선수지식으로 자동 차단 금지,
원본 대화 보존, disposable embedding/summary, Phase 2 provenance 보존.
이 목록의 실제 충족 여부는 [현황표](phase-one-status.md)에서 별도로 관리한다.

## 69. Phase 1의 한 문장 정의

> 범용 LLM이 매 학습 상황에 필요한 최소 지식 구조를 임시로 만들고, 그 구조를 기준으로
> 학습자의 실제 지식 증거를 지속적으로 추적하면서, 기존 커리큘럼 없이도 질문과 프로젝트
> 중심의 학습을 이어갈 수 있게 하는 로컬-first 지식·학습 런타임을 구현한다.

정식 지식 DB는 선행 조건이 아니다. canonical 0개에서도 실제로 사용할 수 있고,
생성된 구조와 증거가 이후 정식 DB 구축의 재료로 손실 없이 남아야 한다.
