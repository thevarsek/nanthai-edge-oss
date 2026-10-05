import {
  CodexAppServerOperator,
  type CodexProbeSummary,
} from "./codex_app_server_operator.ts";
import { PiOperator, type PiProbeSummary } from "./pi_operator.ts";

export type AdapterName = "codex" | "pi";

export type AdapterDescriptor = {
  name: AdapterName;
  implementation: "codex_app_server" | "pi_rpc";
  selected: true;
  transport: "stdio";
};

export interface AdapterRegistry {
  list(): readonly AdapterDescriptor[];
  probe(name: AdapterName): Promise<CodexProbeSummary | PiProbeSummary>;
}

export class LocalAdapterRegistry implements AdapterRegistry {
  constructor(private readonly codex = new CodexAppServerOperator(), private readonly pi = new PiOperator()) {}

  list(): readonly AdapterDescriptor[] {
    return [{
      name: "codex",
      implementation: "codex_app_server",
      selected: true,
      transport: "stdio",
    }, { name: "pi", implementation: "pi_rpc", selected: true, transport: "stdio" }];
  }

  probe(name: AdapterName): Promise<CodexProbeSummary | PiProbeSummary> {
    switch (name) {
      case "codex": return this.codex.inspect();
      case "pi": return this.pi.inspect();
    }
  }
}
