# 답변 생성 파이프라인: 실험 준비도와 권장 검증

점검일: 2026-10-11. 이 문서는 현재 코드의 준비도 평가와 **아직 구현하지 않은 실험 도구의
요구사항**이다. 아래 manifest나 실험 조건을 실행하는 CLI/API가 이미 있다는 뜻은 아니다.
실제 ChatGPT 연결로 답변 생성과 브라우저 재조회는 확인했지만, 교육 정확도나 장기 학습 효과를
측정한 결과로 해석하지 않는다.

## 결론

**작은 수동 실험은 가능하다. 반복 가능한 조건 비교를 위한 실험 플랫폼은 아직 미완성이다.**
단계 분리, 스키마 검증, 입력 snapshot, 근거 보존은 강점이다. 다음 우선순위는 새로운 생성
기능보다 실제 실행 모델 식별, 실험 데이터 격리, 고정 사례집, 조건 manifest, 비교 보고서다.

## 현재 준비도

| 영역 | 현재 상태 | 코드 근거 / 남은 일 |
| --- | --- | --- |
| 단계별 호출 | 준비됨 | `src/server/tutor.ts`, `tutor-stage.ts`: evaluation/extraction/resolution/planning/draft/lint/final 호출과 오류 복구가 분리됨. 의도적 단계 제거를 위한 설정은 없음. |
| 입력·결과 추적 | 상당 부분 준비됨 | `model-runner.ts`, `model-context-version.ts`: bounded StructuredCall, prompt/schema/stage 버전, hash, 출력, 성공/실패 기록. snapshot은 provider에 넘긴 입력이지 인증 정보를 포함한 HTTP 패킷 복사본이 아님. |
| 모델 비교 | 부분적 | `provider-factory.ts`: provider/model 선택 가능. ChatGPT 모드는 `stateModel: null`이고 실제 모델은 호출 시 사용자 설정에서 결정됨. `model-runner.ts`는 정적 `provider.state.model`을 기록하므로 실제 선택 모델이 run metadata에서 누락될 수 있음. |
| 비용·지연 | 부분적 | 성공 호출의 token usage와 단계 latency는 기록됨. 전체 턴 p50/p95, 시도·repair별 비용, 한도·가격 기준은 없음. 스키마 검증 실패 시 usage 저장 전에 예외가 나므로 실패/repair 비용은 과소 집계될 수 있음. |
| 고정 입력 재실행 | 기반만 있음 | snapshot export는 있으나 독립 replay runner, 사례집 schema, 결과 비교 도구는 없음. 과거 snapshot 없는 실행은 정확한 재실행 대상으로 삼을 수 없음. |
| 실험 격리 | 미완성 | 실제 TutorPipeline은 knowledge/evidence/thread를 변경함. live DB에 실행한 뒤 rollback하는 방식은 외부 호출·비용까지 되돌리지 못함. |
| 품질 평가 | 수동 기반만 있음 | `routes-quality.ts`, `docs/quality-evaluation.md`: 수동 관측, 평균, Brier score, synthetic 제외. 조건 배정·맹검·신뢰구간·평가자 일치도 분석 도구는 없음. |
| 지식 검토 | 관리 기능 구현 | 검토·오류 표시·폐기·복원은 사용자별 이벤트로 보존됨. 사람의 관리 판단이지 자동 정답 라벨이나 mastery 근거는 아님. |

기존 테스트는 스키마·권한·상태 전이·불변성 등 **런타임 정확성**의 근거다.
모델의 설명이 맞는지, 전제를 잘 찾는지, 학습자가 실제로 이해했는지는 별도 평가가 필요하다.

## P0: 비교 실험 전에 보강할 것

### 1. 실제 실행 설정과 비용을 정확하게 기록

- 인증 정보를 제외한 실제 resolved model, provider 출력 mode, 요청한 생성 옵션을 run에 고정한다.
- 모델을 선택한 뒤 턴 중간에 설정을 변경해도, 비교 실험의 한 턴은 같은 설정을 쓰게 한다.
  현재 사용자별 모델 resolver를 단계마다 호출하므로 실험 실행 단위의 고정이 별도로 필요하다.
- provider가 반환한 usage는 출력 스키마 검증 성공 여부와 별개로 기록한다. usage가 없는 실패는
  `unknown`으로 남기고 0원/0토큰으로 취급하지 않는다.
- 구조화 오류·repair·fallback을 원래 시도와 연결해 전체 턴 지연과 token 합계를 산출한다.

**권장 테스트:** ChatGPT 선택 모델이 run에 남음, 턴 중 모델 변경에도 조건 불변,
잘못된 JSON/스키마 응답의 알려진 usage 보존, usage 미제공 실패의 unknown 표시,
repair 합산 누락 없음. 토큰·cookie·authorization code는 manifest/export에 넣지 않는다.

### 2. 두 종류의 격리된 실행기를 구분

- **단계 replay:** 고정 StructuredCall을 provider에 보내 parser/validator/결과를 비교한다.
  실서비스 repository를 호출하지 않고 별도 결과 artifact만 쓴다.
- **전체 파이프라인 비교:** 동일한 시작 지식·학습 상태를 복제한 임시 DB를 조건마다 생성한다.
  이전 조건의 추출·검토·노출·평가 결과가 다음 조건의 입력에 섞이지 않게 한다.
- mock provider로 실행기 자체의 무변경·예산·중단 정책을 먼저 검증하고, 실제 모델 호출은
  명시적으로 opt-in한다. mock 성공을 답변 품질 개선의 증거로 쓰지 않는다.

**권장 테스트:** live DB의 rows/hash가 실행 전후 동일, 조건 간 ID/상태 격리,
원본 snapshot hash 검증, 누락 snapshot 명시적 거부, 외부 호출 수 상한,
예산 초과·사용량 제한 시 중단, 재개 시 완료한 사례 중복 과금 방지.

### 3. 사례집과 실험 manifest 고정

manifest에는 다음을 기록한다. 이는 제안 규격이며 현재 실행 명령은 없다.

| 구분 | 권장 필드 |
| --- | --- |
| 식별 | experiment ID, condition ID, case ID, 반복 번호, 실행 시각 |
| 재현 | commit SHA, dataset 버전/hash, 초기 DB fixture hash, 입력 snapshot hash |
| 생성 | 실제 model/provider, prompt/schema/stage 버전, output mode, 요청 옵션 |
| 검색 | embedding profile, 검색 설정, 사용된 knowledge revision 및 review 상태 snapshot |
| 운영 | 단계/턴 timeout, 호출 수·token·금액 예산, 가격표 출처/날짜 |
| 결과 | 성공/실패/불완전, stage별 latency/usage, repair/fallback, 평가 라벨 |

동일 조건 반복도 모델 출력의 결정성을 보장하지 않는다. 지원하지 않는 seed를 가짜로
기록하지 않는다. 프롬프트 변경 비교에서는 prompt hash가 달라지는 것이 정상이다.
같아야 하는 것은 사용자 사례·초기 상태·고정 문맥이고, 변경한 변수는 명시적으로 기록한다.

## 권장 실험 순서

| 순서 | 비교 | 측정할 항목 | 판정 원칙 |
| --- | --- | --- | --- |
| 1 | 현재 기준선의 반복 실행 | 완료율, schema/repair/fallback 비율, 전체 턴·단계 p50/p95, token 합계 | 먼저 기준선 분산을 파악. 약 62초였던 단일 성공 사례를 평균 지연으로 쓰지 않음. |
| 2 | draft/final lint의 기여 | 잘못된 전제, 설명 오류, 답변 포기, 시간·token 차이 | 단계 생략 시 downstream 대체 입력을 먼저 정의. 실패 fallback을 의도적 ablation으로 위장하지 않음. |
| 3 | 추출 범위·검색 문맥 크기 | 중복 provisional, 잘못된 merge, 선수 개념 누락, 문맥 초과 | 같은 사례/초기 DB로 비교. 추출 개수가 적다는 이유만으로 좋은 조건으로 판단하지 않음. |
| 4 | 프롬프트 변경 또는 모델 변경 | 정확성, 현재 목표 충족, 불필요한 진단, 지연·사용량 | 한 번에 한 변수부터. 평가자는 조건명을 모르는 순서로 결과 검토. |
| 5 | learner evaluation 정책 | 독립 설명/복사/응용 구분, evaluator agreement, calibration | 튜터 설명 노출을 학습자 이해 증거로 올리면 실패. 미래 관측 없이 Brier 라벨 생성 금지. |
| 6 | 지식 검토와 검색 연동 | 잘못된/폐기 항목 재사용, 복원, revision 변경, 사용자 격리 | 제외 항목이 검색·직접 target·final 문맥을 우회해 재진입하지 않아야 함. 기존 대화 기록은 보존. |

초기 사례집에는 한국어/영어, 신규/기존 주제, 논리와 타입 이론처럼 용어 의미를 구분해야 하는
질문, 모호한 thread 선택, 긴 문맥, 복사 설명과 새로운 적용, 잘못된 지식 정정, 폐기/복원을
포함한다. 먼저 소규모 smoke set으로 절차를 점검한 뒤, 주효과·변동성과 검정력에 따라 표본 수를
사전에 정한다. 편의상 고른 작은 표본 수를 통계적으로 충분하다고 주장하지 않는다.

## 모든 조건에서 유지할 필수 경계

- 다른 학습자의 기록이나 검토 상태에 영향 없음.
- 과거 revision/evidence/exposure/context snapshot을 수정하거나 현재 정의에 재부착하지 않음.
- 모델이 만든 UUID, revision, source span을 검증 없이 신뢰하지 않음.
- retired unit 및 현재 revision이 incorrect인 항목을 새 지식 문맥에서 제외.
- synthetic와 실제 모델 표본을 분리하고 실패·중단 사례를 보고서에서 숨기지 않음.
- 사용 가능한 usage와 실제 외부 금액 청구를 구분. ChatGPT 플랜 소비를 API 요금표 금액으로
  단정하지 않음.

## 결과 보고 형식

조건별 사례 수/완료 수/중단 사유, primary metric과 평가 기준, paired 차이와 불확실성,
latency/token 분포, repair/fallback, 부정적 사례를 함께 남긴다. 질문이 같은 학습자나 thread에
묶여 있으면 관측치를 모두 독립 표본으로 계산하지 않는다. 일반적인 답변 정확성과 장기
recall/transfer 효과는 별도 결론으로 작성한다.

실제 사용자 export는 민감한 대화·학습 상태를 포함한다. 동의와 비식별화 없이 사례집에 넣지
않는다. 검증용 credentials는 기존 안전한 인증 경로로만 제공하고 실험 artifact에 복사하지
않는다. 실험 도구 구현 전에도 현재 [품질 평가 절차](quality-evaluation.md)에 따라 별도 DB에서
수동 baseline을 만들 수 있다.
