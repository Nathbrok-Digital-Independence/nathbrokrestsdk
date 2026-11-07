class NathbrokAPIError(RuntimeError):
    """Raised when Nathbrok returns an unsuccessful or invalid API response."""

    def __init__(self, status_code: int, detail: object) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Nathbrok API returned HTTP {status_code}: {detail}")
