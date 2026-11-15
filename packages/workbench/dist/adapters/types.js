export class ApiError extends Error {
    uncertain;
    code;
    constructor(message, { uncertain = false, code = "" } = {}) {
        super(message);
        this.name = "ApiError";
        this.uncertain = uncertain;
        this.code = code;
    }
}
