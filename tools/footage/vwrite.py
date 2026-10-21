"""vwrite.py: read and write BGR frames through ffmpeg, for the passes that redraw a video frame by frame.

OpenCV's decode (truncating YUV-to-RGB) and its VideoWriter each lost about 1.2 of 255 of brightness, so a build that
ran three such passes came out 7 darker than the one before it (19 Oct 2026). Decoding and encoding through ffmpeg with
accurate rounding keeps the levels: a frame read with Reader and written back with Writer drifts by 0.03 of 255."""
import subprocess

FLAGS = "accurate_rnd+full_chroma_int+full_chroma_inp+bitexact"


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate",
                          "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip().split(",")
    w, h = int(out[0]), int(out[1]); n, d = out[2].split("/"); return w, h, float(n) / float(d or 1)


class Reader:
    """cap = Reader(path); ok, frame = cap.read(); cap.fps, cap.size — the frames as BGR uint8, like cv2.VideoCapture."""
    def __init__(self, path):
        import numpy as np
        self.np = np; self.w, self.h, self.fps = probe(path); self.size = (self.w, self.h)
        self.p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-sws_flags", FLAGS, "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                                  stdout=subprocess.PIPE, bufsize=10 ** 8)

    def read(self):
        buf = self.p.stdout.read(self.w * self.h * 3)
        if len(buf) < self.w * self.h * 3: return False, None
        return True, self.np.frombuffer(buf, self.np.uint8).reshape(self.h, self.w, 3).copy()

    def release(self):
        self.p.stdout.close(); self.p.wait()


class Writer:
    def __init__(self, out, fps, size, crf=18):
        w, h = size
        self.p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", f"{fps}",
                                   "-i", "-", "-sws_flags", FLAGS, "-c:v", "libx264", "-crf", str(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], stdin=subprocess.PIPE)

    def write(self, frame):
        self.p.stdin.write(frame.tobytes())

    def release(self):
        self.p.stdin.close(); self.p.wait()
