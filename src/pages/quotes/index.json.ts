// Prebuilt quote-search data: every transcript line, compactly encoded.
import type { APIRoute } from 'astro';
import { getEpisodes, getPeople, playable } from '../../lib/content';

export const GET: APIRoute = async () => {
  const [episodes, people] = await Promise.all([getEpisodes(), getPeople()]);
  const withTranscripts = episodes.filter((episode) => episode.transcript);
  const speakers = new Map<string, string>(people.map((person) => [person.id, person.data.short]));

  const data = {
    episodes: withTranscripts.map(playable),
    speakers: Object.fromEntries(speakers),
    // [episodeIndex, startSeconds, speakerId | null, text]
    lines: withTranscripts.flatMap((episode, index) =>
      episode.transcript!.segments.map((segment) => [index, segment.s, segment.sp, segment.t]),
    ),
  };
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
