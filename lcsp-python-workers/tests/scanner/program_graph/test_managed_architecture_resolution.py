from __future__ import annotations

from lcsp_workers.scanner.program_graph.managed_architecture_resolution import (
    ManagedArchitectureResolver,
)
from lcsp_workers.scanner.program_graph.semantic_ir import SemanticProgram


def _edges(program: SemanticProgram) -> set[tuple[str, str, str]]:
    return {(edge.edge_type, edge.source_key, edge.target_key) for edge in program.edges}


def test_spring_event_broker_route_and_di_boundaries_continue(tmp_path) -> None:
    (tmp_path / "Orders.java").write_text(
        '''
class PaymentService {
  public void charge() { }
}

class OrderController {
  @Autowired
  private PaymentService paymentService;

  @GetMapping("/orders")
  public void listOrders() {
    paymentService.charge();
  }

  @EventListener(OrderCompleted.class)
  public void onCompleted(OrderCompleted event) { }

  @KafkaListener(topics = "orders")
  public void consumeOrder(String value) { }

  public void publish() {
    publisher.publishEvent(new OrderCompleted());
    kafkaTemplate.send("orders", "x");
  }
}
''',
        encoding="utf-8",
    )

    program = ManagedArchitectureResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)

    assert any(edge[0] == "HANDLED_BY" and edge[1] == "http-route:GET:/orders" for edge in edges)
    assert any(edge[0] == "CONSUMES_EVENT" and edge[1] == "event:spring:OrderCompleted" for edge in edges)
    assert any(edge[0] == "PUBLISHES_EVENT" and edge[2] == "event:spring:OrderCompleted" for edge in edges)
    assert any(edge[0] == "CONSUMES_FROM_QUEUE" and edge[1] == "queue:kafka:orders" for edge in edges)
    assert any(edge[0] == "PUBLISHES_TO_QUEUE" and edge[2] == "queue:kafka:orders" for edge in edges)
    assert any(
        edge[0] == "RESOLVES_TO" and "PaymentService.charge" in edge[2]
        for edge in edges
    )


def test_dotnet_di_mediatr_and_masstransit_boundaries_continue(tmp_path) -> None:
    (tmp_path / "Program.cs").write_text(
        '''
services.AddScoped<IPaymentService, PaymentService>();

public class PaymentService {
  public void Charge() { }
}

public class PayCommand { }
public class PayHandler : IRequestHandler<PayCommand, bool> {
  public bool Handle(PayCommand request) { return true; }
}

public class OrderCreated { }
public class OrderConsumer : IConsumer<OrderCreated> {
  public void Consume(OrderCreated message) { }
}

public class Controller {
  [HttpPost("pay")]
  public void Pay() {
    mediator.Send(new PayCommand());
    bus.Publish(new OrderCreated());
    var payment = services.GetRequiredService<IPaymentService>();
  }
}
''',
        encoding="utf-8",
    )

    program = ManagedArchitectureResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)

    assert (
        "RESOLVES_TO",
        "dotnet-di:services:IPaymentService",
        "symbol:Program.cs:PaymentService",
    ) in edges
    assert any(edge[0] == "PUBLISHES_COMMAND" and edge[2] == "command:mediatr:PayCommand" for edge in edges)
    assert any(edge[0] == "HANDLES_COMMAND" and edge[1] == "command:mediatr:PayCommand" for edge in edges)
    assert any(edge[0] == "PUBLISHES_EVENT" and edge[2] == "event:masstransit:OrderCreated" for edge in edges)
    assert any(edge[0] == "CONSUMES_EVENT" and edge[1] == "event:masstransit:OrderCreated" for edge in edges)
    assert any(edge[0] == "HANDLED_BY" and edge[1] == "http-route:POST:pay" for edge in edges)
    assert any(edge[0] == "RESOLVES_TO" and edge[2] == "dotnet-di:services:IPaymentService" for edge in edges)
