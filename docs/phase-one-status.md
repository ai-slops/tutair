# Phase 1 구현 현황과 남은 작업

점검일: 2026-09-22. 기준: 사용자가 제공한 원래 0~69절 명세를 정리한
[요구사항 보존본](phase-one-specification.md), 현재 소스, 자동 테스트.
완료율을 임의의 퍼센트로 표시하지 않는다. **기본 런타임은 구현되어 있지만 원래 명세 전체의
완료 선언은 아직 하지 않는다.** scripted/demo 검증은 실제 LLM의 교육 품질 검증과 다르다.

## 문서 대조 결과

기존 `phase-one-contract.md`에는 핵심 invariant, 지식/evidence 모델, 턴 처리,
검색·위험·privacy, 10개 수용 시나리오가 있었다. `learner-model.md`, `backend-api.md`,
`operations.md`, `verification.md`에도 구현 정책과 사용·검증 근거가 있었다.
따라서 요구사항이 전혀 없는 저장소는 아니었다.

다만 원래 절 번호별 대응, 6개 milestone의 진행표, 우선순위가 있는 미완료 목록이 없었고,
원래 모델의 상세 필드·비목표·동기/비동기 구분 일부는 문서에 명시되지 않았다.
이를 보존본과 이 현황표로 보완했다. 보존본은 원문의 축약·정리본이지 원문 파일의 byte-for-byte 사본은 아니다.

## Milestone별 판단

| Milestone | 판단 | 구현 근거 | 남은 범위 |
| --- | --- | --- | --- |
| 1 저장 기반 | 주요 경로, thread 메타데이터, 불변 context snapshot 구현 | `database.ts`, 각 migration, repositories | legacy provenance/snapshot 부재는 미확인으로 유지; system/parent message 예시 모델 차이 |
| 2 Provisional knowledge | 구조화 scope/claim status 및 보수적 resolution 구현 | `knowledge-contracts.ts`, `resolution-policy.ts`, `tutor-knowledge.ts` | 다양한 신규 주제의 최소성·중복·잘못된 merge 실측 |
| 3 Learner model | 과거 재생성, 정정 초기 상태, 평가 source boundary 구현 | `tutor-evaluation-boundary.ts`, `projection-store.ts`, `correction-store.ts` | 실제 평가 신뢰도·calibration 측정 |
| 4 Tutor planning | 새 knowledge/state 전달과 thread lifecycle 구현 | `tutor-turn-context.ts`, `tutor-response.ts`, `thread-selection.ts` | 보수적 선택은 명시적 ID·현재 thread·정확한 제목 일치에 한정; 의미 기반 자동 분류는 구현하지 않음 |
| 5 Concept linter | draft/final lint, annotation 검증, generation snapshot 고정 구현 | `tutor-final.ts`, `exposure-grounding.ts`, `tutor-schemas.ts` | 비차단·최소 진단 정책의 실제 모델 평가 |
| 6 Longitudinal use | metadata 검색·명시적 resume·일관된 thread 선택 구현 | `search.ts`, `retrieval-documents.ts`, `routes-threads.ts`, `tutor-context.ts` | 실제 장기 사용 평가와 한국어 검색 품질 |

위 소스 경로는 `src/server/` 기준이다. 디렉터리명·SQL/API 이름은 원문의 예시와 달라도
책임이 같으면 구현으로 인정하되, 실제 빠진 데이터/행동은 아래에 별도로 남긴다.

## 완료한 작업: 과거 revision projection 재생성

원문 §3.1, §15~17, §39, §66의 reconstructability를 선택했다.

- **기존 문제:** `rebuildProjections`가 `current_revision`만 읽었다. 파생 상태가 삭제되면
  과거 revision의 상태는 복원되지 않았고, 과거 evidence를 나중에 무효화해도 그 revision의
  기존 상태는 갱신되지 않았다.
- **변경:** unit의 모든 immutable revision을 각각 조회해 그 revision의 evidence,
  exposure, correction/invalidation만으로 6개 dimension을 재생성한다.
- **격리:** unit의 aggregate mastery/confidence는 현재 revision으로만 갱신한다.
  `tutor-context.ts`는 projection 갱신 시각이 아니라 unit의 현재 revision을 기준으로 상태를 고른다.
  과거 상태를 다시 만들었다는 이유로 새 정의를 이미 안다고 가정하지 않는다.
- **호환성:** `/api/evidence/rebuild` 입력은 유지한다. `rebuilt`는 revision 수가 아닌 unit 수이다.
  historical state는 revision 조회 API로 확인한다. 타 학습자의 private unit은 여전히 404이다.
- **검증:** `tests/server/projection-rebuild.test.ts`에 단위/전체 rebuild, 원본 보존을 수반한
  과거 evidence 무효화, 학습자 격리, 최신 문맥 revision 선택의 5개 회귀 시나리오를 추가했다.
  구현 전 실제 실패를 확인했다. 최종 실행 결과는 [검증 이력](verification.md)에 남긴다.

이는 과거 시점의 상태를 그대로 되돌리는 time-travel 기능이 아니다. 당시 revision에 대해
**현재까지 기록된 정정과 현재 시점의 staleness 정책**을 적용해 상태를 재계산한다.
알고리즘/동일한 입력·계산 시점이 같으면 값이 동일하다. projection ID·계산 시각은 원본 증거가 아니다.

## 이어서 완료한 작업: exposure provenance 고정

원문 §17/32/65의 노출 보존 경계를 구현했다.

- final 생성 전에 확보한 knowledge revision snapshot을 출력 재시도, final review,
  reply 저장까지 유지한다. 중간에 current revision이 바뀌어도 노출을 새 정의에 붙이지 않는다.
- 새 노출에는 exact `knowledgeRevisionId`, 원본 tutor `messageEventId`,
  `provenance: generation_snapshot`을 저장한다. 메시지 수정·tombstone 이후에도 원본 이벤트를 참조한다.
- DB에서 unit/revision/owner와 tutor message/event의 일치를 검증한다.
  UPDATE/DELETE 및 `INSERT OR REPLACE` 덮어쓰기를 막고 개인정보 삭제만 예외로 허용한다.
- 기존 6열 exposures는 시작 시 transaction으로 확장한다. 기존 unit/revision/owner가 정확히
  매칭되는 경우에만 revision UUID를 채우고, message event를 추측하지 않는다.
  모든 기존 행은 `legacy_unverified`이며 원래 생성 시점 보장을 소급해서 주장하지 않는다.
- 매칭할 revision이 없으면 UUID는 null로 유지한다. 이후 같은 순번의 revision이 생겨도
  자동 연결하거나 그 노출을 새 revision의 projection에 반영하지 않는다.
- 반복 시작은 기존 행을 다시 쓰지 않는다. 일부 열만 수동 추가된 불완전한 스키마는 명시적으로 거부한다.
- 검증: `exposure-provenance.test.ts`, `exposure-migration.test.ts`, `exposure-boundaries.test.ts`.
  실 HTTP 경로와 전체 검사 결과는 [검증 이력](verification.md)에 기록한다.

## 이어서 완료한 작업: 남은 백엔드 계약과 통합 경계

- **문맥 전달:** 최초 resolution 이후 새 정의·6차원 상태·관계를 갱신하여 planning, draft,
  initial lint, final, final review에 전달한다. 기존 관련 unit도 final에서 누락하지 않는다.
  응답 생성은 `tutor-response.ts`, 학습 상태 문맥은 `tutor-learner-context.ts`로 책임을 분리했다.
- **안전 검사:** 긴 사용자 입력 때문에 초안 후반이 잘리지 않도록 draft를 우선 보존한다.
  전체 draft가 예산에 들어가지 않으면 부분 검사 결과를 정상 검사로 취급하지 않는다.
- **LearningThread:** origin/whyNow/desiredOutcome와 target/deferred 단위, abandoned 상태,
  질문 추가·중복 방지·open/parked/resolved 전환을 지원한다. 현재 선택은 conversation별로 유지한다.
  기존 open/paused 상태는 유지하고 active/parked 입력을 alias로 수용한다.
  종료·보류된 thread는 일반 턴에서 자동 재활성화하지 않는다. explicit resume이 필요하다.
  기존 중복 질문을 migration에서 지우지 않으며 metadata 변경은 before/after 이벤트로 보존한다.
- **평가 추적:** evaluationSkipped, followupTrackingSkipped와 구조화된 ambiguity/followup을 기록한다.
  mastery observation은 evaluator에 제공한 exact revision, thread, assessment, related unit과
  UTF-16 source span만 허용한다. 잘못된 출력은 한 번 재생성 후 명시적 fallback 처리하며 일부만 저장하지 않는다.
  learner 메시지가 평가 중 수정되어도 원래 created event를 참조한다.
- **실행 snapshot:** provider에 전달한 bounded StructuredCall(system/data/jsonSchema/stage/version)을
  hash와 함께 불변·학습자 전용으로 저장한다. 성공·실패·재시도 모두 추적하며 export/개인정보 삭제에 포함한다.
  이전 run의 누락 snapshot은 현재 상태로 만들어 채우지 않는다.
- **지식 계약:** structured definitionScope, claim status, 원문 necessity enum과 기존 enum/숫자를 보존한다.
  의미가 다른 구조화 scope의 reuse/canonical 재수입을 막고, LLM이 claim을 스스로 승격하지 못하게 한다.
  revise는 이전 scope/features/claims/sourceRefs를 유지하고 meaning mismatch 새 unit은 즉시 unknown 상태를 만든다.
  test_runner는 실행 결과의 evaluator metadata이며 임의 코드를 실행하는 API가 아니다.
- **불변성:** SQLite 연결의 recursive triggers를 활성화하여 기존 history 테이블의 DELETE guard가
  REPLACE의 내부 삭제에도 적용되게 했다. 정상 INSERT OR IGNORE와 privacy cascade는 유지한다.

구현과 synthetic HTTP 검증은 완료했지만 **실제 LLM 교육 품질·장기 효과는 미완료**이다.
현재 환경에 provider 설정/자격 증명과 `.env`가 없어서 외부 모델 호출을 실행하지 못했다.
수동 품질 보고 API의 통계·합성 데이터 제외·학습자 격리는 검증했다.
[실제 품질 검증 절차](quality-evaluation.md)에 필요한 시나리오와 판정 기준을 분리해 두었다.

## 2026-10-04 프런트엔드 통합 완료 범위

- conversation과 durable learning thread를 분리해 표시하고 생성·목표 수정·상태 전환·명시적 resume를 실제 API에 연결했다.
- 저장된 턴의 selection/running/unknown/failed recovery 상태를 구분한다. 성공한 recovery는 같은 `requestId`를 이어서 처리하며 learner message를 두 번 만들지 않는다.
- deferred knowledge, 질문 lifecycle, response별 tracking-skipped 상태, revision별 6차원 projection provenance를 evidence margin에서 검사·조작할 수 있다. 실패 시 입력과 행을 유지하고 alert를 표시한다.
- 375/768/1280 레이아웃에서 drawer focus/Escape/inert, composer 도달성, CJK wrapping, recovery overflow를 검증했다. 초기 서버 snapshot 전에는 빈 학습 상태를 보여 주지 않고 명시적 loading surface를 표시한다.
- 이 완료 범위는 synthetic fixture의 UI/API 통합 근거이다. 실제 외부 LLM의 교육 정확도나 장기 효과를 의미하지 않는다.

## 원래 명세 0~69절 대응표

표의 **구현**은 해당 동작의 코드 경로가 있다는 뜻이며 일반화된 교육 품질 인증이 아니다.
**부분**은 구체적인 차이/미검증 범위가 있다는 뜻이다. **정책**은 비목표·가이드·완료 기준이다.
소스는 `src/server/`, 테스트는 `tests/server/` 기준이다.

| 절 | 요구사항 | 상태와 근거 |
| --- | --- | --- |
| 0 | DB 없이 시작하고 재평가 자료 보존 | 주요 구현: `tutor.ts` 신규 턴, revision/event에 고정된 새 exposure; legacy 출처는 미확인 표시 |
| 1 | 대화·다차원 상태·전제·자율 학습 | 주요 구현: `repository-core.ts`, `learner-projection.ts`, `tutor-scenarios.test.ts`; 실제 주제 다양성 미측정 |
| 2 | 비목표 | 정책: 자동 정식화/클러스터링/개인 KB 등 Phase 2 유지 |
| 3 | 증거 원본, 독립 호출, 현재 목표 우선 | 구현 + 정책: `model-runner.ts`, `tutor.ts`; 이번 historical rebuild 추가 |
| 4 | 전체 아키텍처 | 구현: `tutor.ts`, `tutor-context.ts`, `tutor-stage.ts`의 논리적 분리 |
| 5 | 핵심 객체 | 주요 구현: `database.ts`; canonical/provisional은 공통 revision 테이블로 구분 |
| 6 | 7가지 unit kind | 구현: `schemas.ts`, `tutor-schemas.ts` |
| 7 | unit와 revision 분리 | 구현: `repository-knowledge.ts`; currentRevision 순번 + immutable revision UUID 사용 |
| 8 | revision 정의·scope·claims·origin | 구현: semanticScope 호환 + definitionScope 구조, claim status, revision별 provenance; 과거 누락 값은 추정하지 않음 |
| 9 | relation과 선수 관계 metadata | 구현: revision-linked 관계와 원문 necessity enum; legacy enum/숫자도 변환 없이 수용 |
| 10 | 최소 provisional 생성 | 구현: 총 24개 후보 상한, 최소 추출 prompt; 실제 최소성은 품질 평가 필요 |
| 11 | 보수적 resolution | 구현: `resolution-policy.ts`, `resolution-policy.test.ts`; 0.9 이상 + scope/kind/revision 일치 조건 |
| 12 | 6개 상태 차원 | 구현: `learner-projection.ts` |
| 13 | revision-pinned evidence 모델 | 구현: `knowledge-inputs.ts`, `repository-evidence.ts`; test_runner의 runner/suite/result metadata 추가 |
| 14 | 증거 강도·복사 할인 | 구현: `learner-projection.ts`, `tutor-policies.ts`, `tutor-scenarios.test.ts` |
| 15 | 재생성 가능한 상태 | 구현: `projection-store.ts`; 이번에는 과거 revision까지 재생성 |
| 16 | weighted aggregation | 구현: `learner-projection.ts`, `learner-model.md`; calibration을 보장하지 않음 |
| 17 | exposure 분리 | 구현: 노출/mastery 분리, generation revision/source event 고정, immutable exposure; legacy 한계 명시 |
| 18 | LearningThread 전체 모델 | 구현: metadata/목표·보류 단위/질문 lifecycle/abandoned/다대다 연결; open·paused 유지 + active·parked 입력 alias |
| 19 | 제한된 turn context | 구현: `tutor-context.ts`, `tutor-model-context.ts`, context budget/state 테스트; 이번 현재 revision 선택 보완 |
| 20 | hybrid retrieval·단위 기반 확장 | 주요 구현: `search.ts`, `retrieval-documents.ts`; 관련 unit/관계 context 확장, 언어별 검색 품질 미측정 |
| 21 | 구조화 TutorPlan | 주요 구현: `planningSchema`, `TutorTurnStore.plan`; 원문 assessment priority/preferredMethod와 다른 형식 |
| 22 | 목표 우선·최소 진단 | 정책 + demo 검증: `model-runner.ts`, `tutor-scenarios.test.ts`; 실제 모델의 불필요한 중단 비율 미측정 |
| 23 | concept lint schema | 구현: `lintedSchema`와 신규 후보 resolution |
| 24 | 실제 draft의 전제 점검 | 구현 + 품질 미검증: draft/final 독립 lint, `tutor-scenarios.test.ts` |
| 25 | response 입력과 제약 | 구현: 새 turn knowledge/state/relations를 draft/lint/final까지 일관 전달, 전체 draft 안전 검사 |
| 26 | 자연스러운 assessment 기회 | 구현: `assessments`, `planningSchema`, 자발적 explanation 테스트 |
| 27 | evaluator 구조화 결과 | 구현: unresolvedAmbiguities[]/suggestedFollowup + legacy openQuestion, supplied-reference/span 검증과 명시적 skipped flag |
| 28 | observation과 상태 계산 분리 | 구현: `TutorTurnStore.evidence` → repository → projection |
| 29 | canonical 우선·provisional fallback | 구현: `orderedResolutionCandidates`, `normalizeResolution` |
| 30 | 수동 canonical import | 구현: `routes-knowledge.ts`, `examples/fsm.yaml`, `backend-knowledge.test.ts` |
| 31 | 원본 message와 삭제 정책 | 주요 구현: immutable edit events/tombstone/privacy; system role/parentMessageId는 없음 |
| 32 | immutable event 보존 | 구현: 원본 history와 question events/context snapshots 보존; ModelRun status는 lifecycle row, 입력 snapshot은 불변 |
| 33 | ModelRun 추적 | 구현: `model-runner.ts`; purpose/version/hash/output/usage/latency/fallback, chain-of-thought 요구 없음 |
| 34 | DB 선택 | 구현: Node SQLite, local-first 선택; PostgreSQL은 권장안이지 필수 조건 아님 |
| 35 | 테이블 구성 | 주요 구현: `database.ts`; 이름은 다르지만 핵심 책임 대응 |
| 36 | FTS·embedding 파생 인덱스 | 구현: `search.ts`, `retrieval-documents.ts`, profile별 cache; 상시 PostgreSQL index와는 다름 |
| 37 | 한 턴 전체 흐름 | 구현: `tutor.ts`; thread를 한 번 선택해 문맥/저장 공유. 현재 thread 우선, 명시적 선택 또는 보수적 후보 선택 |
| 38 | 장기 대화 재개 | 구현: 명시적 resume + 관련 검색/state; 이전 세션 전체 메시지 window를 항상 넣지 않는 것은 요구 위반이 아님 |
| 39 | 과거 revision 보존 | 구현: immutable revisions/evidence; 이번 historical state rebuild + 최신 상태 격리 |
| 40 | 학습자 정정 | 구현: 의미 불일치 새 unit 즉시 unknown 초기화, 정의 수정 시 기존 revision metadata와 원본 source 보존 |
| 41 | 자율 학습 정책 | 정책 + demo 검증: 현재 목표 우선 prompt; 다양한 프로젝트 실사용 평가 필요 |
| 42 | deferred gap | 구현: thread deferred IDs/질문 상태를 보존·문맥에 전달, target 승격 시 deferred에서 제거; 고급 자동 우선순위는 비목표 |
| 43 | 위험 정책 | 구현: `tutor-policies.ts`, `tutor-final.ts`, `tutor-final-safety.test.ts`; 외부 사실 검증은 비목표 |
| 44 | knowledge는 data | 구현: `provider.ts`, `model-runner.ts`; system policy와 JSON data 분리. 모든 prompt injection 방어의 증명은 아님 |
| 45 | structured output | 구현: strict schema + 명시적 compatibility/runtime validation; provider wire/stream 테스트 |
| 46 | extraction schema | 주요 구현: `extractionSchema`; 원문 importance와 현재 confidence를 동일 의미로 취급하지 않음 |
| 47 | resolution schema | 구현: matches/provisional과 applied decision trace/reasonCodes; 원문과 필드명 차이 |
| 48 | planner schema | 주요 구현: `planningSchema`; §21의 assessment metadata 차이 |
| 49 | lint schema | 구현: `lintedSchema`의 6가지 action과 centrality/uncertainty/cost |
| 50 | evaluation schema | 구현: `evaluatedSchema`, ambiguity/followup metadata와 supplied-reference runtime boundary |
| 51 | 내부 API | 구현: `routes-*.ts`, `backend-api.md`; 실제 URL은 원문 예시와 다름 |
| 52 | 서비스 책임 분리 | 구현: repositories, context, stage runner, pipeline, projection; 단일 프로세스 |
| 53 | 추천 구조 | 정책: `src/server` 모듈로 책임 분리, 예시 디렉터리 트리 자체는 필수가 아님 |
| 54 | 동기/비동기 | 구현: 현재 턴 평가와 생성 동기; embedding도 현재 검색 경로에서 await. 별도 비동기 job은 필수 아님 |
| 55 | 실패 처리 | 구현: extraction/lint/evaluation fallback flags와 failed runs/snapshots; 잘못된 observation도 repair 후 평가 생략 표시 |
| 56 | 관측성 | 구현: bounded provider 입력/system/schema, state/revision 참조, hash/version/output/usage/latency/fallback; 외부 모델의 동일 응답 재현 보장은 아님 |
| 57 | privacy | 구현: owner-scoped repositories/search/export/erasure; boundary 테스트 |
| 58 | 개인 KB | 정책: Phase 2 artifact, 구현하지 않음 |
| 59 | unit tests | 구현: projection/resolution/revision 테스트; 아래 수용 시나리오와 함께 해석 |
| 60 | E2E-1~10 | 주요 runtime 경로 자동 검증; 실제 React 프로젝트/수주 간 재방문/일반 LLM 품질은 별도 실사용 검증 필요 |
| 61 | 품질 측정 | 부분: `routes-quality.ts` 수동 labels/평균/Brier/correction count; 실제 longitudinal labeled dataset 없음 |
| 62 | A~E 완료 시나리오 | 부분: synthetic runtime 근거와 기존 실 LLM 두 턴 기록은 있음; 전체 시나리오의 일반화된 완료 선언 보류 |
| 63 | 6 milestones | 정책: 위 milestone 표에서 구현과 미완료 구분 |
| 64 | 단순화 원칙 | 준수: weighted aggregation, adjacency table, 검색 보조 embedding; interest/personal KB 없음 |
| 65 | Phase 2 provenance | 주요 구현: revision/origin/message/run/resolution/evidence/correction/thread 보존, 새 exposure pin/event 고정; legacy 출처 복원 불가 항목 표시 |
| 66 | 7 invariants | 핵심 경로 검증; 과거 projection 재생성과 새 노출 provenance 보완, 일반 모델 품질 검증은 별도 |
| 67 | FSM 프로젝트 예시 | demo flow 있음: `tutor-demo.ts`, `tutor-scenarios.test.ts`; 실제 React reducer 재구성 능력의 증명은 아님 |
| 68 | 시작 체크리스트 | 저장·평가·thread·문맥·노출 provenance 구현 확인; 실제 모델 품질까지 모두 완료하지 않음 |
| 69 | canonical 0개 성공 | runtime 검증됨; 장기 보존 경계와 일반 주제 품질의 미완료 항목을 포함해 최종 완료 판단 |

## 필수 수용 시나리오의 근거

| 원문 | 자동 검증 근거 (`tests/server/`) | 해석 제한 |
| --- | --- | --- |
| E2E-1, E2E-2 | `tutor-scenarios.test.ts`, `backend.test.ts` | demo/scripted provider, canonical 없이 runtime 검증 |
| E2E-3 | `tutor-scenarios.test.ts`, `resolution-policy.test.ts` | 의미 구분 policy와 synthetic 시나리오 |
| E2E-4, E2E-5 | `tutor-scenarios.test.ts`, `tutor-orchestration-contract.test.ts` | 실제 모델의 누락·불필요한 진단 비율은 미측정 |
| E2E-6, E2E-7 | `tutor-scenarios.test.ts`, `tutor-context-state.test.ts` | 복사 할인과 자발적 증거 흐름, 교육 정확도와 구분 |
| E2E-8 | `backend-knowledge.test.ts`, `tutor-scenarios.test.ts` | application 차원 격리 검증; 실제 React artifact 실행은 미검증 |
| E2E-9 | `backend.test.ts`, `persistence-boundaries.test.ts`, context/search 테스트 | resume/검색/문맥 제한 검증; 실제 수주간 longitudinal 실험 아님 |
| E2E-10 | `backend-knowledge.test.ts`, `persistence-boundaries.test.ts`, `projection-rebuild.test.ts` | immutable revision과 과거 상태 재생성 |

## 남은 검증과 명시적인 설계 차이

이전 목록의 stage 전달, thread 모델, 평가·실행 추적과 부가 지식 계약 작업은 구현했다.
thread PATCH와 assembled quality summary API 테스트도 추가했다.

1. **실제 모델 검증 (§60~62): 환경 차단.** provider 설정과 자격 증명 공급 후 별도 테스트 DB에서
   한국어·신규 주제·실제 코드 프로젝트를 실행하고 사람이 원본 근거를 보고 label을 남겨야 한다.
2. **장기 효과: 데이터 필요.** 몇 주 후 회상·전이·calibration은 실제 시간과 학습자 데이터가 필요하다.
   resume 테스트를 장기 학습 효과의 증거로 바꾸어 말하지 않는다.
3. **설계 차이:** Message의 system/parent ID 예시, assessment의 priority/preferredMethod 예시는
   현재 저장·기회 prompt/dimensions/naturalAfter 표현과 동일한 DTO가 아니다. 기존 API 호환을 위해
   이름/표현 차이를 유지한다. thread 선택은 의미 기반 자동 분류가 아니라 보수적 규칙이다.

새 API 제어를 위한 별도 UI 화면, 통계적 교육 calibration, 자동 클러스터링·정식화·개인 KB를
구현했다고 주장하지 않는다. 뒤의 세 항목은 명시적인 Phase 2 범위이다.

## 2026-10-11 generation inspection 완료 범위

- request summary와 lazy run detail endpoint를 구현했다. owner/conversation/request/message/run
  경계가 모두 일치해야 하며 다른 learner 또는 잘못된 conversation은 404다.
- live·recovery·historical UI가 같은 실제 persisted stage 목록을 사용한다. active polling은 즉시
  시작해 2초 간격으로 진행되고 terminal 상태 또는 target 변경 시 중단된다.
- 실패 attempt와 repair는 별도 행으로 남고 원본 run ID로 연결된다. resolved model과 실패
  응답의 알려진 usage도 저장한다.
- context/output/trace는 detail 선택 시에만 읽고 secret pattern을 재귀적으로 redaction한다.
  credential이나 hidden chain-of-thought는 제공하지 않는다.
- 과거 snapshot, model, usage, timing이 없으면 `null`/Unknown을 유지한다. 현재 설정이나 인접
  turn에서 값을 추정하지 않으므로 모든 과거 run의 exact replay를 보장하지 않는다.
