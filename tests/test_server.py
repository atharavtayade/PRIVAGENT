"""
PRIVAGENT — Server Endpoints Test Suite
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from fastapi.testclient import TestClient
from server.app import app

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["privacy_gate"] == "ENFORCED"


def test_metrics_endpoint():
    response = client.get("/metrics")
    assert response.status_code == 200
    data = response.json()
    assert "total_inference_requests" in data


def test_agent_plan_with_sanitized_context():
    payload = {
        "task": "Find the bill status and open the receipt",
        "page": {
            "url": "https://portal.utility.gov/dashboard",
            "title": "Consumer Utility Dashboard",
            "viewport": {"width": 1280, "height": 800}
        },
        "elements": [
            {
                "type": "text",
                "tag": "span",
                "text": "Consumer: [NAME_REDACTED]",
                "_redacted": True,
                "_piiCategory": "NAME"
            },
            {
                "type": "input",
                "tag": "input",
                "inputType": "password",
                "value": "[PASSWORD_REDACTED]",
                "selector": "#pwd",
                "_redacted": True,
                "_piiCategory": "PASSWORD"
            },
            {
                "type": "button",
                "tag": "button",
                "text": "View Receipt",
                "selector": "#btn-view-receipt",
                "bbox": [400, 300, 120, 40]
            }
        ],
        "privacy_metadata": {
            "totalRedactions": 2,
            "categoryCounts": {"NAME": 1, "PASSWORD": 1},
            "policyMode": "BALANCED",
            "rawDataSent": False,
            "sanitized": True
        }
    }

    response = client.post("/agent/plan", json=payload)
    assert response.status_code == 200
    plan = response.json()
    assert plan["status"] == "in_progress"
    assert len(plan["actions"]) > 0
    assert plan["actions"][0]["type"] == "CLICK"
    assert plan["actions"][0]["target"]["text"] == "View Receipt"


def test_privacy_validation_clean():
    payload = {
        "elements": [
            {
                "type": "input",
                "tag": "input",
                "inputType": "email",
                "value": "[EMAIL_REDACTED]",
                "selector": "#email",
                "_redacted": True
            }
        ]
    }
    response = client.post("/privacy/validate", json=payload)
    assert response.status_code == 200
    assert response.json()["valid"] is True
    assert response.json()["leak_detected"] is False


def test_privacy_validation_catches_leak():
    payload = {
        "elements": [
            {
                "type": "input",
                "tag": "input",
                "inputType": "email",
                "value": "raw_user_leak@example.com",
                "selector": "#unmasked-field",
                "_redacted": False
            }
        ]
    }
    response = client.post("/privacy/validate", json=payload)
    assert response.status_code == 200
    assert response.json()["valid"] is False
    assert response.json()["leak_detected"] is True


if __name__ == "__main__":
    test_health_check()
    test_metrics_endpoint()
    test_agent_plan_with_sanitized_context()
    test_privacy_validation_clean()
    test_privacy_validation_catches_leak()
    print("All unit tests passed successfully!")
