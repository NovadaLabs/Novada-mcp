# 07 - YouTube: France vs Norway FIFA 2026

## Test Command
```bash
novadaScrape({
  platform: 'youtube.com',
  operation: 'youtube_video-post-keyword',
  params: { keyword: 'France vs Norway FIFA 2026', num: 5 },
  limit: 5,
  format: 'markdown'
})
```

## Results

| # | Title | Channel | Views | Date | Duration | URL |
|---|-------|---------|-------|------|----------|-----|
| 1 | Norway vs Senegal Extended Highlights | FOX Sports (1.96M) | 1,524,561 | Jun 22, 2026 | 16:20 | https://www.youtube.com/watch?v=vcgzGgM4uJg |
| 2 | Highlights \| Norway 3-2 Senegal | FIFA (30.4M) | 2,011,773 | Jun 23, 2026 | 2:10 | https://www.youtube.com/watch?v=nlghqbCqbe0 |
| 3 | Norway vs France Preview \| Predictions + Pick to win | CBS Sports (1.21M) | 26,759 | Jun 25, 2026 | 8:00 | https://www.youtube.com/watch?v=EtYPlWFWuZY |
| 4 | Highlights \| France 3-0 Iraq | FIFA (30.4M) | 1,781,345 | Jun 23, 2026 | 2:10 | https://www.youtube.com/watch?v=XejscwNpvLU |
| 5 | France vs Senegal Extended Highlights | FOX Sports (1.96M) | 2,566,212 | Jun 16, 2026 | 17:16 | https://www.youtube.com/watch?v=SlmYDbzHqjg |

## Metrics
- **Latency:** 13,015ms
- **Response size:** 4,482 chars
- **Records returned:** 5/5
- **Status:** PASS

## Fields Returned
title, id, url, thumbnailUrl, viewCount, date, likes, location, channelName, channelUrl, numberOfSubscribers, duration, commentsCount, text, descriptionLinks, subtitles, video_supported_languages, video_supported_audio_languages, isMonetized, commentsTurnedOff, resolution, success, input

## Notes
- No direct France vs Norway match video yet (match is Jun 27). Results include both teams' Group stage matches and a CBS Sports preview.
- Rich metadata: resolution (up to 1080p60), subtitles, subscriber counts, monetization status all captured.
- All 5 records have `success: true`.
