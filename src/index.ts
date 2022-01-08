import joplin from "api";
import { debounce, uniq } from "lodash";
import JoplinData from "api/JoplinData";
import { Path } from "api/types";

// Credit: https://github.com/forcewake/joplin-tags-generator/blob/main/src/index.ts#L14-L98
async function getAll(api: JoplinData, path: Path, query: any): Promise<any[]> {
  query.page = 1;
  let response = await api.get(path, query);
  let result = !!response.items ? response.items : [];
  while (!!response.has_more) {
    query.page += 1;
    let response = await api.get(path, query);
    result.concat(response.items);
  }
  return result;
}

const autoTagUpdate = async (noteId: string, forceUpdate: boolean) => {
  const note = await joplin.data.get(["notes", noteId], {
    fields: ["id", "title", "body"],
  });
  const noteText = note.title + "\n" + note.body;
  // Allow @ symbol for people mentions
  const tags1 = [...noteText.matchAll(/\s#([\w+@])/g)];
  console.debug("Tags1", tags1);
  // Extract group match
  const tags = tags1.map((e) => e[1].toLowerCase());
  let allTags = await getAll(joplin.data, ["tags"], {
    fields: ["id", "title"],
    page: 1,
  });
  const noteTags: string[] = (
    await getAll(joplin.data, ["notes", noteId, "tags"], {
      fields: ["id"],
      page: 1,
    })
  ).map((t) => t.id);
  console.debug("All Tags in notebook: ", noteTags);

  // TODO: optimization use object for constant time lookups
  //allTags = allTags.filter(t => !noteTags.includes(t.id));
  console.debug("All Tags: ", allTags);

  const updateTag = async (tagId: string) => {
    await joplin.data.post(["tags", tagId, "notes"], null, {
      id: noteId,
    });
  };

  console.debug("Tags in post: ", uniq(tags));
  // TODO: guard clause to exit early if they match
  uniq(tags).forEach(async (keyword) => {
    console.debug("Processing tag: ", keyword);
    if (keyword.length < 3) return;
    const tag = allTags.find((t) => t.title.toLowerCase() == keyword);
    let tagId;
    if (!tag) {
      const newTag = await joplin.data.post(["tags"], null, {
        title: keyword,
      });
      console.debug("Created tag: ", newTag.id);
      tagId = newTag.id;
    } else {
      tagId = tag.id;
    }
    updateTag(tagId);
    console.debug("Updated tag: ", tagId);
  });
};

const debouncedTagUpdate = debounce(
  (id: string) => autoTagUpdate(id, false),
  5000,
  { trailing: true, leading: false }
);

// TODO: setup a force overwrite to make tags match what's in the doc
joplin.plugins.register({
  onStart: async function () {
    await joplin.commands.register({
      name: "autoTagUpdate",
      label: "Update auto tags ie parse note title and body for tags",
      execute: async (_noteIds: string[]) => {
        let note = await joplin.workspace.selectedNote();
        await autoTagUpdate(note.id, true);
      },
    });

    joplin.workspace.onNoteChange(async (event: any) => {
      enum ItemChangeEventType {
        Create = 1,
        Update = 2,
        Delete = 3,
      }

      console.debug(
        "autoTag called for onNoteChange",
        event,
        ItemChangeEventType.Update
      );
      if (event.event != ItemChangeEventType.Update) return;
      // Wait until DELAY since last time event was sent to improve odds that full content is in TITLE
      await debouncedTagUpdate(event.id);
    });
  },
});
