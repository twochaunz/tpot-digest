from app.services.classifier import prepare_tweet, categorize_assigned_tweet, recategorize_topic_tweets


def test_pipeline_functions_exist():
    """Verify the pipeline functions exist and are callable."""
    assert callable(prepare_tweet)
    assert callable(categorize_assigned_tweet)
    assert callable(recategorize_topic_tweets)
