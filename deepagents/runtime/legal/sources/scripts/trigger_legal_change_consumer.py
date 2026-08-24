#!/usr/bin/env python3
"""Publish a test message to trigger the LegalChangeDetectorConsumer."""

import argparse
import json
import os
import pika

def load_env(env_path):
    if not os.path.exists(env_path):
        return {}
    env_vars = {}
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip("'\"")
            env_vars[k.strip()] = v
    return env_vars

def main():
    parser = argparse.ArgumentParser(description="Trigger LegalChangeDetectorConsumer")
    parser.add_argument("--document-id", default="134-2025-QH15", help="Target document ID")
    parser.add_argument("--source-url", default="https://vbpl.vn/van-ban/chi-tiet/luat-tri-tue-nhan-tao-so-134-2025-qh15--69ba65c0-8a56-11f1-878c-399a87bcb3eb", help="Target source URL")
    parser.add_argument("--catalog-source-ref", default="catalog-source:vbpl.vn:law:134-2025-QH15", help="Catalog source ref")
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env_vars = load_env(os.path.join(project_root, ".env"))
    
    rabbitmq_url = os.environ.get("RABBITMQ_URL") or env_vars.get("RABBITMQ_URL") or "amqp://guest:guest@localhost:5672/%2F"
    exchange = os.environ.get("RABBITMQ_EXCHANGE") or env_vars.get("RABBITMQ_EXCHANGE") or "lcsp.events"
    routing_key = "cron.legal-catalog.check-updates.v1"

    payload = {
        "documentId": args.document_id,
        "sourceUrl": args.source_url,
        "catalogSourceRef": args.catalog_source_ref,
        "baseSnapshotRef": "snapshot:134-2025-QH15:abcd1234",
        "adminCatalogVersion": "v1",
        "idempotencyKey": "test-trigger-134",
        "actorRef": "test-user",
        "expectedDocumentNumber": "134/2025/QH15",
        "gatewayDocumentId": "69ba65c0-8a56-11f1-878c-399a87bcb3eb",
        "maxBytes": 50000000,
    }

    try:
        connection = pika.BlockingConnection(pika.URLParameters(rabbitmq_url))
        channel = connection.channel()
        
        # Ensure exchange exists (topic exchange)
        channel.exchange_declare(exchange=exchange, exchange_type="topic", durable=True)
        
        message_body = json.dumps(payload)
        
        channel.basic_publish(
            exchange=exchange,
            routing_key=routing_key,
            body=message_body,
            properties=pika.BasicProperties(
                content_type="application/json",
                delivery_mode=2,  # make message persistent
            )
        )
        
        print(f"✅ Successfully published test message to exchange '{exchange}'")
        print(f"   Routing Key : {routing_key}")
        print(f"   Payload     : {message_body}")
        
        connection.close()
    except Exception as e:
        print(f"❌ Failed to publish message: {e}")

if __name__ == "__main__":
    main()
