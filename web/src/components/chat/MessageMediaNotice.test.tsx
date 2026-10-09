import {render,screen} from "@testing-library/react";
import {describe,expect,it} from "vitest";
import {MessageMediaNotice} from "./MessageMediaNotice";

describe("shared media notices",()=>{
  it("explains the OpenRouter dependency without hiding committed local text",()=>{
    render(<><p>My local reply</p><MessageMediaNotice notice="openrouter_required"/></>);
    expect(screen.getByText("My local reply")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(/OpenRouter/);
  });
  it("tolerates nullable and future notice codes without showing raw keys",()=>{
    const {rerender,container}=render(<MessageMediaNotice notice={null}/>);
    expect(container).toBeEmptyDOMElement();
    rerender(<MessageMediaNotice notice="future_notice"/>);
    expect(screen.getByRole("status")).not.toHaveTextContent("future_notice");
  });
});
