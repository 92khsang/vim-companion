public record Order(
    String id,
    String customer,
    int quantity,
    long unitPriceCents,
    Status status
) {
    public enum Status {
        DRAFT,
        CONFIRMED,
        SHIPPED
    }

    public long totalCents() {
        return quantity * unitPriceCents;
    }

    public Order confirm() {
        if (quantity < 1) {
            throw new IllegalStateException(
                "An order needs at least one item"
            );
        }
        return new Order(
            id, customer, quantity,
            unitPriceCents, Status.CONFIRMED
        );
    }
}
