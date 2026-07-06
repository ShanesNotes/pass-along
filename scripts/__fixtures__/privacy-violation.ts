const rawQuery = "therapist near me";

console.log(rawQuery);

analytics.track("find_submitted", { query: rawQuery });

await db.from("queries").insert({ raw_text: rawQuery });
