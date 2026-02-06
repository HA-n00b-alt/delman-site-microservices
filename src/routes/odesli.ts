import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import logger from '../utils/logger';

const router = Router();

// Odesli API: https://linktree.notion.site/API-d0ebe08a5e304a55928405eb682f6741 — no API keys
const ODESLI_LINKS_PATH = '/v1-alpha.1/links';

/**
 * Validates that the given string looks like a music link (Spotify, Apple, etc.).
 * Allows common streaming URLs; Odesli will reject unsupported ones.
 */
function isValidMusicLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host.includes('spotify.com') ||
      host.includes('apple.com') ||
      host.includes('music.apple.com') ||
      host.includes('deezer.com') ||
      host.includes('tidal.com') ||
      host.includes('youtube.com') ||
      host.includes('youtu.be') ||
      host.includes('soundcloud.com') ||
      host.includes('amazon.com') ||
      host.includes('music.amazon') ||
      host.includes('song.link') ||
      host.includes('odesli.co')
    );
  } catch {
    return false;
  }
}

/**
 * @openapi
 * /v1/odesli:
 *   get:
 *     summary: Get Odesli links for a music URL
 *     description: Queries the Odesli (Songlink) API with a Spotify or other streaming link and returns the universal links response. API is used without authentication per official docs (no API keys issued).
 *     tags:
 *       - Odesli
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: url
 *         in: query
 *         required: true
 *         description: Full music URL (e.g. Spotify track/album/artist link)
 *         schema:
 *           type: string
 *           example: "https://open.spotify.com/track/1GZH9Sv6zCIse2GKihRHKy"
 *     responses:
 *       200:
 *         description: Odesli API response with platform links and entity info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: Raw response from Odesli API (entityByUniqueId, linksByPlatform, etc.)
 *       400:
 *         description: Missing or invalid url parameter
 *       401:
 *         description: Unauthorized
 *       502:
 *         description: Odesli API error or unreachable
 */
router.get('/odesli', async (req: Request, res: Response): Promise<void> => {
  const rawUrl = req.query.url;
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    res.status(400).json({
      error: 'Missing or invalid query parameter',
      details: 'Query parameter "url" is required and must be a non-empty string (e.g. a Spotify track URL).',
    });
    return;
  }

  const url = rawUrl.trim();
  if (!isValidMusicLink(url)) {
    res.status(400).json({
      error: 'Invalid music link',
      details: 'The url must be a supported streaming link (e.g. Spotify, Apple Music, Deezer, Tidal, YouTube, SoundCloud, Amazon Music, or song.link/odesli.co).',
    });
    return;
  }

  const baseUrl = env.ODESLI_API_BASE_URL.replace(/\/$/, '');
  const odesliUrl = `${baseUrl}${ODESLI_LINKS_PATH}?url=${encodeURIComponent(url)}`;

  try {
    const response = await fetch(odesliUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      logger.warn(
        { status: response.status, url: odesliUrl, body: data },
        'Odesli API error'
      );
      res.status(response.status >= 500 ? 502 : response.status).json({
        error: 'Odesli API request failed',
        status: response.status,
        details: typeof data === 'object' && data !== null ? data : { message: response.statusText },
      });
      return;
    }

    res.json(data);
  } catch (err) {
    logger.error({ err, url: odesliUrl }, 'Odesli API request failed');
    res.status(502).json({
      error: 'Odesli API unreachable',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
