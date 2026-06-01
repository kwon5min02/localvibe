"""
DSPy 기반 갤러리 검색 프롬프트 최적화.

폴백 구조:
  DSPy 성공 -> DSPy 결과 사용
  DSPy 실패/결과 없음 -> 기존 수동 프롬프트로 폴백
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# uvicorn cwd와 무관하게 back/.env 를 읽음 (main.py와 동일)
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_ENV_FILE = _BACKEND_ROOT / ".env"
load_dotenv(dotenv_path=_ENV_FILE, override=True)

logger = logging.getLogger(__name__)

_dspy_lm = None
_dspy_configured = False

try:
    import dspy as _dspy_module

    _DSPY_AVAILABLE = True
except ImportError:
    _dspy_module = None
    _DSPY_AVAILABLE = False


def _resolve_model_path() -> Path:
    raw = (os.getenv("DSPY_GALLERY_MODEL_PATH") or "dspy_gallery_optimized.json").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = _BACKEND_ROOT / path
    return path


def _flag_enabled() -> bool:
    return os.getenv("USE_DSPY_GALLERY", "false").strip().lower() in {
        "1",
        "true",
        "y",
        "yes",
        "on",
    }


def _get_dspy():
    return _dspy_module


def _ensure_dspy_configured() -> bool:
    """DSPy LM 설정. 실패 시 False."""
    global _dspy_lm, _dspy_configured
    if _dspy_configured:
        return True
    if not _DSPY_AVAILABLE:
        return False
    try:
        dspy = _get_dspy()
        if dspy is None:
            return False
        api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPEN_API_KEY")
        if not api_key:
            logger.warning("[DSPY] API 키 없음 -> DSPy 비활성화")
            return False
        model_name = os.getenv("DSPY_OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
        _dspy_lm = dspy.LM(
            model=f"openai/{model_name}",
            api_key=api_key,
            temperature=0.3,
        )
        try:
            dspy.settings.configure(lm=_dspy_lm)
        except Exception:
            dspy.configure(lm=_dspy_lm)
        _dspy_configured = True
        return True
    except Exception:
        logger.exception("[DSPY] 초기화 실패")
        return False


if _DSPY_AVAILABLE:
    import dspy

    class GallerySearchIntent(dspy.Signature):
        """갤러리 검색 질문의 사용자 의도 파악."""

        user_query: str = dspy.InputField(desc="사용자의 자연어 갤러리 검색 질문")
        relation: str = dspy.OutputField(desc="동행 관계: couple/family/friends/formal/solo/unknown")
        mood: str = dspy.OutputField(desc="분위기: calm/trendy/local/nature/night/food/culture/unknown")
        transport: str = dspy.OutputField(desc="이동 수단: public/car/unknown")
        region: str = dspy.OutputField(desc="언급된 지역명 (없으면 unknown)")

    class GallerySearchRecommendation(dspy.Signature):
        """갤러리 피드용 장소 추천."""

        user_query: str = dspy.InputField(desc="사용자의 원본 검색 질문")
        place_list: str = dspy.InputField(desc="장소 데이터 목록 (id, 이름, 지역, 유형, 요약)")
        intent_summary: str = dspy.InputField(desc="분석된 사용자 의도 요약")
        answer: str = dspy.OutputField(desc="사용자에게 보여줄 추천 이유")
        recommended_ids: str = dspy.OutputField(
            desc="추천 장소 id, 쉼표 구분. place_list에 있는 id만 사용. "
            "사용자가 절·사찰 제외를 요청하면 종교시설 id는 절대 넣지 마세요."
        )

    class GallerySearchRecommender(dspy.Module):
        def __init__(self):
            super().__init__()
            self.analyze_intent = dspy.ChainOfThought(GallerySearchIntent)
            self.recommend = dspy.ChainOfThought(GallerySearchRecommendation)

        def forward(self, user_query: str, place_list: str) -> dspy.Prediction:
            intent = self.analyze_intent(user_query=user_query)
            intent_summary = (
                f"동행관계={intent.relation}, "
                f"원하는분위기={intent.mood}, "
                f"이동수단={intent.transport}, "
                f"희망지역={intent.region}"
            )
            result = self.recommend(
                user_query=user_query,
                place_list=place_list,
                intent_summary=intent_summary,
            )
            return dspy.Prediction(
                answer=result.answer,
                recommended_ids=result.recommended_ids,
                relation=intent.relation,
                mood=intent.mood,
            )

else:
    class GallerySearchRecommender:  # type: ignore
        pass


_TRAINSET_RAW: list[dict] = [
    {
        "user_query": "연인이랑 분위기 좋은 데 가고 싶어",
        "recommended_ids": "210,10872,11533,883,829,813,1970,6299,10101",
        "answer": "연인과 함께 분위기 좋은 카페와 아름다운 자연 명소를 중심으로 골랐어요.",
    },
    {
        "user_query": "분좋카 어디 없어?",
        "recommended_ids": "210,10872,11533,883,6299,829,813,1970,10101",
        "answer": "분위기 좋고 감성적인 카페들을 중심으로 골랐어요.",
    },
    {
        "user_query": "데이트하기 좋은 감성 카페 추천",
        "recommended_ids": "210,10872,11533,883,829,1970,813,6299,10101",
        "answer": "데이트하기 좋은 감성 카페와 산책하기 좋은 공원을 함께 골랐어요.",
    },
    {
        "user_query": "혼행하기 좋은 곳",
        "recommended_ids": "210,10872,11533,12112,7735,883,829,1970,813",
        "answer": "혼자 여유롭게 즐길 수 있는 카페와 전시, 문화 공간을 골랐어요.",
    },
    {
        "user_query": "혼자 조용히 힐링하고 싶어",
        "recommended_ids": "883,829,6299,10101,813,1970,210,10872,11533",
        "answer": "혼자 조용히 쉬기 좋은 공원과 자연 명소를 위주로 골랐어요.",
    },
    {
        "user_query": "친구들이랑 맛집 투어 하고 싶어",
        "recommended_ids": "6298,7820,9572,210,10872,883,6299,829,11533",
        "answer": "친구들과 즐기기 좋은 맛집과 카페를 중심으로 골랐어요.",
    },
    {
        "user_query": "친구랑 당일치기 여행",
        "recommended_ids": "1970,829,813,883,6299,10101,12112,7735,210",
        "answer": "당일치기로 가볍게 다녀오기 좋은 관광지와 자연 명소를 골랐어요.",
    },
    {
        "user_query": "가족이랑 아이 데리고 가볼 만한 곳",
        "recommended_ids": "12112,7735,883,829,6299,10101,813,1970,10872",
        "answer": "아이와 함께 즐길 수 있는 박물관, 공원, 자연 명소를 골랐어요.",
    },
    {
        "user_query": "어사 데려가기 좋은 식당",
        "recommended_ids": "7820,6298,210,10872,11533,883,9572,6299,829",
        "answer": "처음 만나는 사이에도 어색하지 않은 분위기 좋은 곳들을 골랐어요.",
    },
    {
        "user_query": "소개팅 장소 추천해줘",
        "recommended_ids": "210,10872,11533,7820,6298,883,829,6299,813",
        "answer": "소개팅하기 좋은 감성 카페와 편안한 분위기의 식당을 골랐어요.",
    },
    {
        "user_query": "자연 속에서 힐링하고 싶어",
        "recommended_ids": "829,883,6299,10101,813,1970,10872,210,11533",
        "answer": "자연 속에서 힐링할 수 있는 공원과 자연 명소를 골랐어요.",
    },
    {
        "user_query": "뷰맛집 어디 있어?",
        "recommended_ids": "813,1970,829,883,10101,6299,210,10872,11533",
        "answer": "경치가 아름다운 뷰맛집과 전망 좋은 장소들을 골랐어요.",
    },
    {
        "user_query": "박물관이나 전시 보고 싶어",
        "recommended_ids": "12112,7735,883,829,10101,813,6299,1970,210",
        "answer": "문화적으로 풍부한 박물관과 전시 공간을 중심으로 골랐어요.",
    },
    {
        "user_query": "찐맛집 알려줘",
        "recommended_ids": "6298,7820,9572,210,10872,883,6299,11533,829",
        "answer": "현지인들이 즐겨 찾는 찐맛집들을 골랐어요.",
    },
    {
        "user_query": "제주도 여행 추천",
        "recommended_ids": "813,829,1970,883,210,10872,6299,10101,11533",
        "answer": "제주도의 아름다운 자연과 명소들을 중심으로 골랐어요.",
    },
    {
        "user_query": "여수 여행 코스 추천",
        "recommended_ids": "1970,813,829,883,6299,210,10101,10872,11533",
        "answer": "여수의 아름다운 바다와 명소들을 중심으로 골랐어요.",
    },
    {
        "user_query": "뚜벅이 여행 코스",
        "recommended_ids": "883,12112,7735,210,10872,6298,9572,829,6299",
        "answer": "대중교통으로 편하게 갈 수 있는 장소들을 골랐어요.",
    },
    {
        "user_query": "감성 사진 찍기 좋은 곳",
        "recommended_ids": "210,10872,11533,813,829,1970,883,6299,10101",
        "answer": "감성적인 사진을 찍기 좋은 카페와 자연 명소를 골랐어요.",
    },
    {
        "user_query": "핫플 어디야",
        "recommended_ids": "210,10872,11533,883,829,813,1970,12112,7735",
        "answer": "요즘 인기 있는 핫플레이스들을 골랐어요.",
    },
    {
        "user_query": "부산 야경 보러 가고 싶어",
        "recommended_ids": "7820,7735,883,829,813,1970,6299,210,10872",
        "answer": "부산의 야경 분위기를 즐기기 좋은 장소들을 중심으로 골랐어요.",
    },
    {
        "user_query": "부산에서 친구들이랑 트렌디하게 놀 곳, 절은 안 가고 싶어",
        "recommended_ids": "210,10872,11533,6298,7820,9572,883,829,813",
        "answer": "친구와 함께 즐기기 좋은 핫플·맛집·카페 위주로 골랐고 사찰은 제외했어요.",
    },
    {
        "user_query": "맛집 위주로 추천해줘 사찰 말고",
        "recommended_ids": "6298,7820,9572,210,10872,883,6299,829,11533",
        "answer": "맛집과 카페 위주로 골랐고 사찰·종교시설은 넣지 않았어요.",
    },
]


def _build_trainset():
    if not _DSPY_AVAILABLE:
        return []
    dspy = _get_dspy()
    trainset = []
    for ex in _TRAINSET_RAW:
        trainset.append(
            dspy.Example(
                user_query=ex["user_query"],
                place_list="",
                recommended_ids=ex["recommended_ids"],
                answer=ex["answer"],
            ).with_inputs("user_query", "place_list")
        )
    return trainset


def _gallery_metric(example, prediction, trace=None) -> float:
    try:
        pred_ids = set(s.strip() for s in str(prediction.recommended_ids).split(",") if s.strip())
        true_ids = set(s.strip() for s in str(example.recommended_ids).split(",") if s.strip())
        if not true_ids:
            return 0.0
        return len(pred_ids & true_ids) / len(true_ids)
    except Exception:
        return 0.0


def optimize_and_save(save_path: str = "dspy_gallery_optimized.json"):
    if not _DSPY_AVAILABLE:
        raise RuntimeError("dspy-ai가 설치되어 있지 않습니다.")
    if not _ensure_dspy_configured():
        raise RuntimeError("DSPy 초기화 실패")
    dspy = _get_dspy()
    trainset = _build_trainset()
    logger.info("[DSPY] 학습 데이터 %d개로 최적화 시작", len(trainset))
    recommender = GallerySearchRecommender()
    optimizer = dspy.MIPROv2(
        metric=_gallery_metric,
        auto="light",
        num_threads=4,
    )
    optimized = optimizer.compile(
        recommender,
        trainset=trainset,
        max_bootstrapped_demos=3,
        max_labeled_demos=5,
    )
    optimized.save(save_path)
    logger.info("[DSPY] 최적화 완료. 저장: %s", save_path)
    return optimized


def load_optimized(save_path: str = "dspy_gallery_optimized.json"):
    recommender = GallerySearchRecommender()
    recommender.load(save_path)
    return recommender


_recommender_instance: Optional[GallerySearchRecommender] = None


def get_gallery_recommender() -> Optional[GallerySearchRecommender]:
    global _recommender_instance
    if _recommender_instance is not None:
        return _recommender_instance
    if not _flag_enabled():
        return None
    if not _DSPY_AVAILABLE:
        logger.warning("[DSPY] dspy-ai 미설치 — pip install dspy-ai")
        return None
    if not _ensure_dspy_configured():
        logger.warning("[DSPY] LM 초기화 실패 — OPENAI_API_KEY 확인")
        return None
    save_path = _resolve_model_path()
    if save_path.is_file():
        _recommender_instance = load_optimized(str(save_path))
        logger.info("[DSPY] 활성 — 최적화 모델 로드: %s", save_path.name)
    else:
        logger.warning("[DSPY] 활성 — %s 없음, 기본 ChainOfThought 모델 사용", save_path)
        _recommender_instance = GallerySearchRecommender()
    return _recommender_instance


def run_dspy_gallery_search(user_query: str, place_list_str: str) -> dict:
    recommender = get_gallery_recommender()
    if recommender is None:
        return {}
    try:
        prediction = recommender(user_query=user_query, place_list=place_list_str)
        raw_ids = str(getattr(prediction, "recommended_ids", "") or "")
        parsed_ids: list[int] = []
        for token in raw_ids.split(","):
            token = token.strip()
            if token.isdigit():
                parsed_ids.append(int(token))
        logger.info(
            "[DSPY] 추론 완료 ids=%d candidates_lines=%d",
            len(parsed_ids),
            place_list_str.count("\n") + 1 if place_list_str else 0,
        )
        return {
            "answer": str(getattr(prediction, "answer", "") or ""),
            "recommendedRegionIds": parsed_ids,
        }
    except Exception:
        logger.exception("[DSPY] 추론 실패 — baseline으로 폴백")
        return {}


if __name__ == "__main__":
    import argparse
    from app.repositories import load_regions

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--optimize", action="store_true")
    parser.add_argument("--infer", type=str, default="")
    parser.add_argument("--show-trainset", action="store_true", help="학습 데이터 목록 출력")
    args = parser.parse_args()

    if args.show_trainset:
        trainset = _build_trainset()
        print(f"\n총 학습 데이터 {len(trainset)}개:\n")
        for ex in trainset:
            print(f"  Q: {ex.user_query}")
            print(f"  A ids: {str(ex.recommended_ids)[:50]}...")
            print()
    elif args.optimize:
        print(f"갤러리 검색 프롬프트 최적화 시작 ({len(_TRAINSET_RAW)}개 학습 데이터)...")
        optimize_and_save()
        print("완료!")
    elif args.infer:
        try:
            rows = load_regions()
            place_lines = []
            for row in rows[:100]:
                place_lines.append(
                    f"- id={row['id']} / 이름={row['name']} / 지역={row.get('region','')} "
                    f"/ 유형={row.get('category','')} / 요약={str(row.get('summary',''))[:100]}"
                )
            place_list_str = "\n".join(place_lines)
        except Exception:
            place_list_str = (
                "- id=210 / 이름=쟝리 6-6 / 지역=광주 / 유형=카페 / 요약=광주 서구의 감성 카페\n"
                "- id=1970 / 이름=향일암 / 지역=여수 / 유형=관광지 / 요약=여수의 숨은 보석\n"
                "- id=883 / 이름=서서울호수공원 / 지역=서울 / 유형=공원 / 요약=도심 속 자연의 쉼터\n"
            )
        result = run_dspy_gallery_search(args.infer, place_list_str)
        print(f"\n질문: {args.infer}")
        print(f"답변: {result.get('answer', '')}")
        print(f"추천 ids: {result.get('recommendedRegionIds', [])}")
    else:
        parser.print_help()
