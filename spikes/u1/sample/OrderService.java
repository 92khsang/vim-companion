import java.util.List;

public final class OrderService {
    private final List<Order> orders;

    public OrderService(List<Order> orders) {
        this.orders = List.copyOf(orders);
    }

    public List<Order> pendingOrders() {
        return orders.stream()
            .filter(order ->
                order.status() == Order.Status.DRAFT
            )
            .toList();
    }

    public long confirmedTotalCents() {
        return orders.stream()
            .filter(order ->
                order.status() == Order.Status.CONFIRMED
            )
            .mapToLong(Order::totalCents)
            .sum();
    }

    public List<Order> forCustomer(String name) {
        return orders.stream()
            .filter(order ->
                order.customer().equals(name)
            )
            .toList();
    }
}
