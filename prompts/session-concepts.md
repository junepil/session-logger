- 아래 사용자 메시지에서 이 세션에서 새로 등장하여 설명된 기술 개념들을 추출하세요. 
- 반드시 JSON 배열로만 출력하세요 (마크다운 코드블록·다른 텍스트 없이 raw JSON만). 
형식: 
```json
{
  "filename": "kebab-case.md",
  "title": "개념명",
  "tags": ["tag1", "tag2"],
  "summary": "1-3문장 요약",
  "details": "상세 설명 (마크다운 가능)
}. 
```
- Spring Boot, Kotlin, AWS, argoCD, terraform 관련 스택 개념
- 광고 및 Customer Data Platform 프로젝트 도메인 개념
- 개념이 없으면 []만 출력.
