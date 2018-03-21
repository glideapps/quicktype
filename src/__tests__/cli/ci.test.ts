import * as ci from "../../cli/ci";

describe("tryHash", () => {
    it("should get undefined if any parameter is", () => {
        const hash = ci.tryHash(["hello", undefined, "world"]);
        expect(hash).toBeUndefined();
    });

    it("should get a string if all parameters are", () => {
        const hash = ci.tryHash(["hello", "world"]);
        expect(typeof hash).toBe("string");
    });
});

describe("getProvider", () => {
    it("should get a provider for Travis", () => {
        const provider = ci.getProvider({
            TRAVIS_REPO_SLUG: "quicktype/quicktype"
        });
        expect(provider && provider.provider).toBe("Travis");
    });

    it("should get undefined provider for empty environment", () => {
        const provider = ci.getProvider({});
        expect(provider).toBeUndefined();
    });
});
