#!/usr/bin/env python3
"""
Pinecone에 **직접 벡터 upsert용** Dense 인덱스를 만듭니다 (통합 임베딩 없음).
차원 384 + cosine → `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` 와 호환.

실행 (back 디렉터리, venv 활성화 후):

  cd back && source .venv/bin/activate
  PYTHONPATH=. python scripts/create_pinecone_dense_index.py

통합 임베딩(llama 등)으로 잘못 만든 인덱스가 있으면 **삭제 후 재생성**:

  PYTHONPATH=. python scripts/create_pinecone_dense_index.py --recreate

환경변수 (.env):
  PINECONE_API_KEY   (필수)
  PINECONE_INDEX     (필수, 만들 인덱스 이름)
  PINECONE_CLOUD     (선택, 기본 aws)
  PINECONE_REGION    (선택, 기본 us-east-1)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

BACK = Path(__file__).resolve().parents[1]
if str(BACK) not in sys.path:
    sys.path.insert(0, str(BACK))


def _is_integrated_index(desc) -> bool:
    """콘솔에 Model: llama-… 처럼 나오는 인덱스면 True (우리 코드와 비호환)."""
    embed = getattr(desc, "embed", None)
    if embed is None:
        return False
    return bool(getattr(embed, "model", None))


def main() -> None:
    parser = argparse.ArgumentParser(description="Create BYOV Pinecone index (384, cosine)")
    parser.add_argument("--cloud", default=os.getenv("PINECONE_CLOUD", "aws"))
    parser.add_argument("--region", default=os.getenv("PINECONE_REGION", "us-east-1"))
    parser.add_argument("--dimension", type=int, default=384)
    parser.add_argument("--metric", default="cosine")
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="기존 인덱스 삭제 후 BYOV 인덱스로 다시 생성 (데이터 전부 삭제됨)",
    )
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(BACK / ".env")

    api_key = os.getenv("PINECONE_API_KEY", "").strip()
    name = os.getenv("PINECONE_INDEX", "").strip()
    if not api_key or not name:
        print("PINECONE_API_KEY 와 PINECONE_INDEX 가 .env 에 필요합니다.", file=sys.stderr)
        sys.exit(1)

    from pinecone import Pinecone, ServerlessSpec

    pc = Pinecone(api_key=api_key)

    if pc.has_index(name):
        desc = pc.describe_index(name)
        bad = _is_integrated_index(desc)
        if bad and not args.recreate:
            print(
                f"[경고] 인덱스 '{name}' 은 통합 임베딩 인덱스입니다 (embed.model 설정됨).",
                file=sys.stderr,
            )
            print(
                "  로컬 Sentence-Transformers + upsert(values) 코드와 맞지 않습니다.",
                file=sys.stderr,
            )
            print(
                "  해결: 아래로 삭제 후 BYOV 인덱스로 재생성 (Record 0 이면 안전):\n"
                "       PYTHONPATH=. python scripts/create_pinecone_dense_index.py --recreate",
                file=sys.stderr,
            )
            sys.exit(2)
        if not bad and not args.recreate:
            print(f"이미 적합한 BYOV 인덱스: {name}")
            print(f"  host={getattr(desc, 'host', None)}")
            print(f"  dimension={getattr(desc, 'dimension', None)}")
            print(f"  metric={getattr(desc, 'metric', None)}")
            return
        if args.recreate:
            print(f"기존 인덱스 삭제 (--recreate): {name}")
            pc.delete_index(name)
            for _ in range(60):
                if not pc.has_index(name):
                    break
                time.sleep(2)
            else:
                print("삭제 후에도 인덱스가 남아 있습니다. 콘솔에서 삭제 후 다시 실행하세요.", file=sys.stderr)
                sys.exit(1)

    print(f"인덱스 생성 중: name={name} dimension={args.dimension} metric={args.metric}")
    print(f"  serverless cloud={args.cloud} region={args.region} (통합 임베딩 없음)")

    pc.create_index(
        name=name,
        spec=ServerlessSpec(cloud=args.cloud, region=args.region),
        dimension=args.dimension,
        metric=args.metric,
    )

    print("제어 평면에 생성 요청 완료. 프로비저닝에 1~2분 걸릴 수 있습니다.")
    for i in range(36):
        time.sleep(5)
        try:
            desc = pc.describe_index(name)
            if _is_integrated_index(desc):
                print("[오류] 새 인덱스가 통합 임베딩으로 생성된 것으로 보입니다. Pinecone 쪽 설정을 확인하세요.", file=sys.stderr)
                sys.exit(3)
            status = getattr(desc, "status", None)
            ready = getattr(status, "ready", None) if status is not None else getattr(desc, "ready", None)
            if ready is True:
                print(f"인덱스 준비됨: host={getattr(desc, 'host', None)}")
                break
        except Exception as e:
            print(f"  대기 중… ({i + 1}/36) {e}")
    else:
        print("아직 Ready 확인 실패. 콘솔에서 상태 확인 후 시딩 스크립트를 실행하세요.")

    print("다음: PYTHONPATH=. python scripts/embed_places_to_pinecone.py")


if __name__ == "__main__":
    main()
