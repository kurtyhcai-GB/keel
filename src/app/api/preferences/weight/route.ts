import { handle, readJson } from "@/lib/api";
import { updateSkillsWeight } from "@/lib/data";
import { skillsWeightInput } from "@/lib/schemas";

export function PATCH(request: Request) {
  return handle(async () => {
    const input = skillsWeightInput.parse(await readJson(request));
    return Response.json(await updateSkillsWeight(input.skillsWeight));
  });
}
