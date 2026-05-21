from app.services.smart_title import _fallback_title_case


def test_fallback_title_case_preserves_existing_tech_casing():
    assert _fallback_title_case("OpenAI and GPT-5 reshape NYC schools") == "OpenAI and GPT-5 Reshape NYC Schools"
    assert _fallback_title_case("SendCutSend adds iMessage support via xAI") == "SendCutSend Adds iMessage Support via xAI"


def test_fallback_title_case_recovers_common_acronyms_from_lowercase():
    assert _fallback_title_case("openai gpt-5 and nyc ai policy") == "OpenAI GPT-5 and NYC AI Policy"
    assert _fallback_title_case("ios imessage xai api updates") == "iOS iMessage xAI API Updates"
    assert _fallback_title_case("nvidia gpu and github javascript sdk") == "NVIDIA GPU and GitHub JavaScript SDK"
