from app.models import Account, AccountSource, Topic, LifecycleStatus


def test_account_defaults():
    account = Account(handle="testuser")
    assert account.handle == "testuser"
    assert account.priority == 2
    assert account.is_active is True


def test_topic_defaults():
    topic = Topic(title="Test Topic")
    assert topic.lifecycle_status == LifecycleStatus.EMERGING
    assert topic.rank == 0
