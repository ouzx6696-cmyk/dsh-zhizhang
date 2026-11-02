import { candidateStage } from "./candidates/candidate-stage.js";
import { candidateEditBrief } from "./candidates/candidate-edit-brief.js";
import { candidateEditStage } from "./candidates/candidate-edit-stage.js";
import { candidateEditDecide } from "./candidates/candidate-edit-decide.js";
import { chapterDrafts } from "./candidates/chapter-drafts.js";
import { candidateUnifyBrief } from "./candidates/candidate-unify-brief.js";
import { candidateUnifyStage } from "./candidates/candidate-unify-stage.js";
import { candidateAccept } from "./candidates/candidate-accept.js";
export function candidatesTools() {
  return [
    candidateStage,
    candidateEditBrief,
    candidateEditStage,
    candidateEditDecide,
    chapterDrafts,
    candidateUnifyBrief,
    candidateUnifyStage,
    candidateAccept,
  ];
}
