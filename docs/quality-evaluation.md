# Phase 1 실제 학습 품질 검증

현재 상태(2026-09-22): 이 작업 환경에는 외부 provider 설정/자격 증명과 `.env`가 없다.
이번 실행에서는 synthetic runtime과 품질 API를 검증했으며 실제 LLM 교육 품질이나 장기 효과를
측정하지 않았다. 과거 실 API 두 턴 성공을 현재 모델의 품질 수치로 재사용하지 않는다.

## 준비

1. README에 따라 신뢰하는 provider를 설정한다. API key는 환경 변수 또는 gitignored `.env`로만
   공급하고 기록·스크린샷·export에 넣지 않는다. strict 모드가 기본이며 streaming-only endpoint만
   명시적으로 compatibility 모드를 사용한다.
2. 기존 학습자 DB가 아닌 별도 임시 디렉터리의 `TUTOR_DB_PATH`로 서버를 시작한다.
   새 세션에서 `/api/capabilities`의 `synthetic: false`를 확인한다.
3. 최초 canonical row가 0개인지 확인한다. 시험 자료는 합성 질문/공개 예제만 사용한다.
4. 각 결과의 learner message, tutor message, model run 및 exact revision ID를 보존한다.
   export의 `modelRunContexts`와 `evaluation_outcome` trace로 실제 입력과 skipped 여부를 확인한다.

## 시나리오

| 사례 | 입력/진행 | 사람이 확인할 기준 |
| --- | --- | --- |
| 한국어 신규 주제 | “FSM은 무엇이고 UI 상태 관리에 왜 쓰나요?” | 현재 질문에 먼저 답하고 최소 micrograph만 생성; 설명만으로 mastery 증가 금지 |
| 의미 구분 | 일상적 “형식적”과 형식 모델의 “형식적” 비교 | 다른 scope를 잘못 merge하지 않음 |
| 복사와 독립 설명 | 직전 설명 반복 후 자신의 새로운 예시 제시 | 복사 할인과 독립 observation 차이를 원본 span으로 추적 |
| 코드 프로젝트 | 공개 React reducer의 loading/success 모순 사례를 FSM으로 변경 | 실제 실행/테스트로 요구사항 확인; application이 explanation/transfer로 자동 확장되지 않음 |
| 다른 신규 주제 | 수학/과학의 별도 안정적 주제 | FSM demo 패턴이 아닌 실제 모델의 추출·전제 판단 정확도 |
| 대화 재개 | thread를 park한 후 명시적 resume, 질문 해결 | desiredOutcome/보류 항목/근거 복구; 전체 대화 dump 금지 |
| 장기 재방문 | 몇 주 뒤 동일 학습자가 새 문제에 답함 | 실제 recall/transfer와 사전 예측의 일치; 단순 resume 성공과 구분 |

새 API로 프로젝트 metadata와 질문 상태를 설정할 수 있다. UI가 해당 제어를 제공하지 않는 경우
[Backend API](backend-api.md)의 thread 생성·PATCH·question·resume endpoint를 사용한다.

## 라벨과 보고

`POST /api/quality/observations`로 사람이 직접 판단한 관측만 남긴다. 예:

```json
{
  "messageId": "검토 대상 메시지 UUID",
  "metric": "incorrect_merge",
  "value": 0,
  "note": "원본 후보와 연결된 revision의 scope를 확인한 검토 근거"
}
```

- extraction_correct, provisional_duplicate, incorrect_merge, evaluator_agreement:
  추출 단위/결정별로 원본 근거를 검토하고 note에 평가 단위와 기준을 남긴다.
- unnecessary_diagnostic, missed_prerequisite, answer_abandoned:
  현재 목표와 대화 진행을 보고 판정한다. 중단 여부를 추정해 채우지 않는다.
- predicted_correctness: 결과를 보기 전의 예측과 나중의 binary 관측값을 기록해야 한다.
  미래 관측이 없으면 라벨을 만들지 않는다.
- synthetic tutor message에 붙인 라벨은 기본 보고에서 제외된다.
  `/api/quality?includeSynthetic=true`는 테스트 데이터 확인용이며 실제 교육 품질 보고와 구분한다.

`GET /api/quality`의 samples/mean/Brier score를 표본 수·provider/model 버전·언어·주제와 함께
보고한다. samples는 수동 라벨 수이며 자동으로 전체 질문 수나 독립 학습자 수를 뜻하지 않는다.
미측정 metric의 null을 0 또는 완벽한 점수로 바꾸지 않는다. 작은 표본 평균을 일반화하지 않는다.

## 정리와 완료 판정

원본 근거를 안전하게 보관한 후 테스트 학습자에만 `/api/privacy`를 실행한다.
내보낸 파일, 백업, provider-side logs는 별도의 보존·삭제 정책이 필요하다.
Phase 1 최종 완료 선언은 runtime 성공뿐 아니라 원래 A~E 시나리오의 실제 모델 사용 근거를
검토한 뒤 한다. 장기 학습 효과는 시간을 두고 별도로 수집한다.
