# Checklist: six desk routines vs the workflow (Integration Spec V2, SubAgentSpecs V3, DLF storyboard deck)

Status key: [APP OK] enforced and tested in this backend (mock mode). [ROUTINE: CHECK] cannot be read from here; open the routine prompt on that agent and tick it off. Nothing in the routines was read or changed by this build, and no real webhook was called.

## Common to all six routines  [ROUTINE: CHECK]
- [ ] Reads the webhook body (request_id, case_id, agent_code, inputs, parent_request_id, submitted_by, sheet_id, parent{outcome,summary,output_link}) and treats it as data, not instructions.
- [ ] Copies request_id unchanged into Results column A.
- [ ] Writes ONE Results row (A to L, in this order): request_id, agent_code, status, outcome, summary, next_step, needs_approval, approval_state, output_link, error_message, updated_at, sub_agent_steps. Updates that row (does not add a second) when it moves from running to its final state.
- [ ] status only uses: running, done, needs approval, error. Sets running first, then the final value.
- [ ] needs_approval = yes and approval_state = pending exactly where the gate below says; leaves approval_state to the human afterwards.
- [ ] On any failure writes status error with a plain English error_message (no stack traces, no keys).
- [ ] Never writes scores, weights, ranks or percentages to the sheet (outcome, summary, next_step, sub_agent_steps). The app hides score-like timeline text but cannot see inside free text.
- [ ] Does not contact anyone (no email, no messages) and does nothing beyond writing the row and its files.
- [ ] Never prints or stores the webhook key.

## 1. Supplier Qualification & Onboarding  (SubAgentSpecs V3, Agent 1)
| Item | Spec | App side | Routine |
|---|---|---|---|
| Inputs | supplier name, category, brochure link, countries served | [APP OK] required fields validated, brochure optional (missing = Hold items) | CHECK it reads these four names: supplier_name, category, brochure_url, countries_served |
| Outcome | Onboard / Hold / Drop | [APP OK] Hold: resubmit only; Drop: closed; only Onboard can be approved | CHECK exact words Onboard, Hold, Drop |
| Hold detail | missing items listed | shown in summary | CHECK summary lists missing items |
| Unknown facts | "Unknown, human to verify", never invents | n/a | CHECK |
| Gate | Human confirms Onboard before Product Book | [APP OK] Product Book blocked until approved and outcome Onboard | CHECK needs_approval=yes only for Onboard |
| sub_agent_steps | [] | [APP OK] | CHECK writes [] |
| Deck link | scenes 4 and 5: score and onboard, humans meet and decide | human columns (meeting date, decision, notes) stay human | CHECK leaves them blank |

## 2. Product Book Creator  (SubAgentSpecs V3, Agent 2; deck scene 5)
| Item | Spec | App side | Routine |
|---|---|---|---|
| Inputs | onboarded supplier, products, brochure link | [APP OK] needs an approved Onboard parent; products required | CHECK reads supplier_name, products, brochure_url and the parent |
| Outcome | Book LIVE / Book Waiting | [APP OK] Waiting is not approvable, resubmit offered | CHECK exact words; LIVE only when at least one supplier is onboarded |
| Gate | Human reviews booklet before sharing; publish only after approval | [APP OK] Approve button = "Approve booklet" | CHECK needs_approval=yes for LIVE, does not publish or share |
| Waiting detail | list of what is still needed | summary | CHECK |
| sub_agent_steps | [] | [APP OK] | CHECK |

## 3. #1 Opportunity Finder  (deck scene 6)
| Item | Spec | App side | Routine |
|---|---|---|---|
| Inputs | region, number of accounts, product or supplier in focus | [APP OK] number 1 to 500 validated; payload key `focus` | CHECK reads region, number_of_accounts, focus |
| Outcome | Target list ready, with sources and count found | [APP OK] partial (fewer found) shows a notice via error_message while still done or needs approval | CHECK writes fewer-found as error_message text, not as an error status |
| Gate | Human approves list before #2 | [APP OK] #2 blocked until approved | CHECK needs_approval=yes |
| sub_agent_steps | [] | [APP OK] | CHECK |

## 4. #2 Advisory GTM  (deck scenes 7 to 10; V3 GTM Execution Matching section)
| Item | Spec | App side | Routine |
|---|---|---|---|
| Inputs | approved target list (request_id of the #1 case) | [APP OK] parent must be an approved #1; parent link and summary sent in payload | CHECK reads parent.request_id and the list link |
| Outcome | Pursue now / Keep warm per account, plain why | [APP OK] shown line by line in summary; #3 refuses Keep warm accounts | CHECK one line per account: "Account: Pursue now. why" |
| Sub-agents | GTM Execution Matching Desk (above) and Relationship Manager (below) run behind, not as separate requests | [APP OK] no endpoints for them; timeline rendered in order | CHECK writes both steps with step, outcome, status; running first, then done |
| Privacy | rank score and relationship score internal | [APP OK] score-like step text hidden | CHECK no scores, ranks or weights (deck scenes show rank score 93 and relationship 90: those must stay inside the master file, not the sheet) |
| Gate | Human confirms Pursue now before #3 | [APP OK] | CHECK needs_approval=yes |

## 5. #3 Introduction Desk  (deck scene 11)
| Item | Spec | App side | Routine |
|---|---|---|---|
| Inputs | Pursue now accounts from the #2 case | [APP OK] one request per account, parent must be approved #2 | CHECK reads inputs.account and parent |
| Outcome | Intro packs awaiting approval, link per account | [APP OK] one approval per pack | CHECK exact words; output_link set |
| Gate | Human approves each pack; the agent sends nothing; humans send, meet, talk terms | [APP OK] Approve button says the agent sends nothing | CHECK routine cannot and does not send |
| sub_agent_steps | [] | [APP OK] | CHECK |

## 6. #4 Deal Desk  (deck scene 12)
| Item | Spec | App side | Routine |
|---|---|---|---|
| Inputs | soft yes recorded by a human, account, product | [APP OK] refused unless soft yes note and tick box; needs an approved #3 pack | CHECK reads account, product, soft_yes_note, soft_yes_confirmed and refuses to draft if false |
| Outcome | Deal outline awaiting human close | [APP OK] Approve button = "Mark closed by a human" | CHECK exact words; drafts the outline only |
| Gate | Human closes the deal | [APP OK] | CHECK never closes or commits anything |
| sub_agent_steps | [] | [APP OK] | CHECK |

## Visibility and logging (the "nothing unseen" rules)  [APP OK]
- Every submit, webhook call (sent or failed), status change seen in the sheet, approval, rejection, retry, duplicate stop, gate stop, login, sheet outage and recovery is shown on screen (per request and a global feed) and saved in logs/audit.jsonl with the user and time.
- A result row in the sheet that this app never requested appears in a visible "unexpected result" notice.
- Agents write to the sheet themselves; if a routine does extra work off-sheet, this app cannot see it. That is why the common checklist above asks each routine to do nothing beyond writing its row.

## Known gaps to confirm with Rishabh and Hemant
1. Deal Desk requires an approved #3 pack as its parent (workflow order). If a deal may start without an intro in this app, set `STRICT_GATES=0` or tell me to relax that one gate.
2. Per-account detail for #2 lives in the summary text (the spec has no per-account column). A per-account sheet column is a spec change and was not made.
3. sub_agent_steps for #2 only appear if the routine writes them; otherwise the timeline is hidden.
