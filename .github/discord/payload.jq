# GitHub のイベントの JSON から、Discord の Webhook に送る JSON を作る
# 引数：$event（イベントの名前）
# PR を作る・レビュー待ちにする・レビューを頼むイベントでは、ワークフローが次を足す
#   .pull_request：待ったあとに取り直した PR
#   .started：実行が始まった時刻、.ready_at：最後にレビュー待ちにした時刻（UNIX 時間の秒。無ければ 0）
# 知らせないイベントでは何も出さない

def cut($n): if length > $n then .[0:$n - 1] + "…" else . end;
def who: {name: .login, icon_url: .avatar_url};
def names: map(.login // .name) | join(", ");

def blurple: 5793266;
def green: 5763719;
def red: 15548997;
def failed: . == "failure" or . == "timed_out" or . == "startup_failure";
def purple: 9001189;
def gray: 9807270;

def pr_embed($text; $color; $fields):
  .pull_request as $p
  | {
      title: ("#\($p.number) \($p.title)" | cut(256)),
      url: $p.html_url,
      description: $text,
      color: $color,
      author: (.sender | who),
      fields: ([{name: "ブランチ", value: ("`" + $p.head.ref + "`"), inline: true}] + $fields)
    };

def reviewers_field:
  (.pull_request.requested_reviewers + .pull_request.requested_teams) as $r
  | if ($r | length) > 0 then [{name: "レビュー", value: ($r | names), inline: true}] else [] end;

# 作る・レビュー待ちにする実行は、20秒待ってからレビュアーを取り直して載せる。
# そのあいだに来たレビューの依頼は、そちらに載るので送らない
def pull_request_embed:
  .pull_request as $p
  | if .action == "closed" then
      if $p.merged then pr_embed("マージした"; purple; [])
      else pr_embed("マージせずに閉じた"; gray; []) end
    elif .action == "opened" then
      pr_embed("PR を作った"; blurple;
        [{name: "状態", value: (if $p.draft then "下書き" else "レビュー待ち" end), inline: true}] + reviewers_field)
    elif $p.draft then empty
    elif .action == "ready_for_review" then
      pr_embed("下書きからレビュー待ちにした"; blurple; reviewers_field)
    elif .action == "review_requested" then
      if (.started - ($p.created_at | fromdateiso8601)) < 20 or (.started - .ready_at) < 20 then empty
      else pr_embed("レビューを頼んだ"; blurple; reviewers_field) end
    else empty end;

def review_embed:
  .review as $r
  | if .action != "submitted" then empty
  elif .review.state == "approved" then pr_embed("承認した（Approve）"; green; [])
  elif .review.state == "changes_requested" then pr_embed("修正を求めた（Request changes）"; red; [])
  else empty end
  | .url = $r.html_url
  | if (($r.body // "") | length) > 0 then .fields += [{name: "コメント", value: ($r.body | cut(1024))}] else . end;

def issue_embed:
  if .action != "opened" then empty
  else
    .issue as $i
    | {
        title: ("#\($i.number) \($i.title)" | cut(256)),
        url: $i.html_url,
        description: "Issue を作った",
        color: blurple,
        author: (.sender | who),
        fields: (if ($i.labels | length) > 0 then [{name: "ラベル", value: ($i.labels | map(.name) | join(", "))}] else [] end)
      }
  end;

def workflow_run_embed:
  .workflow_run as $w
  # run の name は run-name の値になる（Deploy はコミットを入れている）ので、ワークフローはファイルで見分ける
  | ($w.path | ltrimstr(".github/workflows/")) as $file
  | if .action != "completed" or $w.head_branch != "main" then empty
    # 本番へのデプロイは main の CI のあとに workflow_run で動く。main への push の CI と、その Deploy だけを知らせる
    elif $w.event != (if $file == "deploy.yml" then "workflow_run" else "push" end) then empty
    elif $file == "ci.yml" and ($w.conclusion | failed) then ["main の CI が落ちた", red]
    elif $file == "deploy.yml" and $w.conclusion == "success" then ["本番にデプロイした", green]
    elif $file == "deploy.yml" and ($w.conclusion | failed) then ["本番へのデプロイが落ちた", red]
    else empty end
  # Deploy の head_sha は、動き出したときの main の最新で、デプロイしたコミットと違うことがある。
  # Deploy は run の名前を「<コミットの1行目> (<SHA>)」にしているので、そこから読む
  | ($w.display_title | capture("^(?<message>.*) \\((?<sha>[0-9a-f]{40})\\)$")
      // {message: ($w.head_commit.message // $w.display_title), sha: $w.head_sha}) as $c
  | {
      title: (.[0]),
      url: $w.html_url,
      description: ($c.message | split("\n")[0] | cut(4096)),
      color: (.[1]),
      author: ($w.actor | who),
      fields: [{name: "コミット", value: ("`" + $c.sha[0:7] + "`"), inline: true}]
    };

if $event == "pull_request_target" then pull_request_embed
  elif $event == "pull_request_review" then review_embed
  elif $event == "issues" then issue_embed
  elif $event == "workflow_run" then workflow_run_embed
  else empty end
# allowed_mentions を空にして、タイトルに @everyone などがあってもメンションにしない
| {allowed_mentions: {parse: []}, embeds: [.]}
