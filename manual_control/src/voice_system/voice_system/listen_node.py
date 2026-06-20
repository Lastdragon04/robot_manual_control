#!/usr/bin/env python3
"""
语音识别 ROS2 节点 — Silero VAD 实时检测 + SenseVoiceSmall 语音识别

录音链路:
  pyaudio 采集 → Silero VAD 逐帧判断"是否在说话"
  → 检测到说话开始 → 累积音频帧
  → 检测到说话结束 → SenseVoiceSmall 识别（内存直传，不落盘） → 发布 /voice/text

发布 Topic:
  /voice/text   — 识别出的文本 (std_msgs/String)
  /voice/status — 当前状态: idle / speaking / recognizing (std_msgs/String)

启动方式:
  ros2 run voice_system listen_node
"""

import os
import threading

import numpy as np
import pyaudio
import torch
from silero_vad import load_silero_vad

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

# ============================================================
# 默认配置
# ============================================================

_DEFAULT_MODELS_DIR = "/home/zck/workspace/robot_manual_control/Models/Voice"
_DEFAULT_SAMPLE_RATE = 16000
_DEFAULT_CHANNELS = 1
_DEFAULT_CHUNK = 512
_DEFAULT_MIN_SPEECH_MS = 300
_DEFAULT_MAX_SILENCE_MS = 800
_DEFAULT_VAD_THRESHOLD = 0.9


# ============================================================
# AudioRecorder — pyaudio 录音器
# ============================================================

class AudioRecorder:
    """封装 pyaudio，支持 with 语句自动管理资源"""

    def __init__(self, sample_rate=16000, channels=1, chunk=512):
        self.sample_rate = sample_rate
        self.channels = channels
        self.chunk = chunk
        self.audio = None
        self.stream = None

    def __enter__(self):
        self.audio = pyaudio.PyAudio()
        self.stream = self.audio.open(
            format=pyaudio.paInt16,
            channels=self.channels,
            rate=self.sample_rate,
            input=True,
            frames_per_buffer=self.chunk,
        )
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.stream:
            self.stream.stop_stream()
            self.stream.close()
        self.audio.terminate()

    def read_frame(self):
        return self.stream.read(self.chunk)

    def get_sample_width(self):
        return self.audio.get_sample_size(pyaudio.paInt16)


# ============================================================
# SenseVoiceModel — ASR 识别模型封装
# ============================================================

class SenseVoiceModel:
    """SenseVoiceSmall 语音识别，内部用 funasr AutoModel 加载"""

    def __init__(self, model_path, vad_model_path):
        self.model_path = model_path
        self.vad_model_path = vad_model_path
        self.model = None

        # 标记 → 中文描述
        self._emoji_dict = {
            "<|nospeech|><|Event_UNK|>": "(未知事件)",
            "<|zh|>": "", "<|en|>": "", "<|yue|>": "", "<|ja|>": "", "<|ko|>": "",
            "<|nospeech|>": "",
            "<|HAPPY|>": "(开心)", "<|SAD|>": "(伤心)", "<|ANGRY|>": "(生气)",
            "<|NEUTRAL|>": "", "<|FEARFUL|>": "(害怕)", "<|DISGUSTED|>": "(厌恶)",
            "<|SURPRISED|>": "(惊讶)",
            "<|BGM|>": "(背景音乐)", "<|Speech|>": "",
            "<|Applause|>": "(掌声)", "<|Laughter|>": "(笑声)", "<|Cry|>": "(哭声)",
            "<|EMO_UNKNOWN|>": "", "<|Sneeze|>": "(喷嚏)", "<|Breath|>": "(呼吸声)",
            "<|Cough|>": "(咳嗽)", "<|Sing|>": "(歌声)",
            "<|Speech_Noise|>": "(说话噪音)",
            "<|withitn|>": "", "<|woitn|>": "", "<|GBG|>": "", "<|Event_UNK|>": "",
        }
        self._lang_dict = {
            "<|zh|>": "<|lang|>", "<|en|>": "<|lang|>",
            "<|yue|>": "<|lang|>", "<|ja|>": "<|lang|>",
            "<|ko|>": "<|lang|>", "<|nospeech|>": "<|lang|>",
        }
        self._init_model()

    def _init_model(self):
        from funasr import AutoModel
        self.model = AutoModel(
            model=self.model_path,
            vad_model=self.vad_model_path,
            vad_kwargs={"max_single_segment_time": 30000},
            trust_remote_code=True,
        )

    def _format_text(self, s):
        """将识别结果中的特殊标记替换为中文描述"""
        for token, desc in self._emoji_dict.items():
            s = s.replace(token, desc)
        for lang_token in self._lang_dict:
            s = s.replace(lang_token, "<|lang|>")
        parts = [p.strip() for p in s.split("<|lang|>") if p.strip()]
        return " ".join(parts)

    def inference(self, input_wav, language="zh", fs=16000):
        """执行语音识别，返回格式化后的文本"""
        if isinstance(input_wav, tuple):
            fs, input_wav = input_wav
            input_wav = input_wav.astype(np.float32) / np.iinfo(np.int16).max
            if len(input_wav.shape) > 1:
                input_wav = input_wav.mean(-1)
            if fs != 16000:
                import torchaudio
                resampler = torchaudio.transforms.Resample(fs, 16000)
                t = torch.from_numpy(input_wav).to(torch.float32)
                input_wav = resampler(t[None, :])[0, :].numpy()

        result = self.model.generate(
            input=input_wav,
            cache={},
            language=language,
            use_itn=True,
            batch_size_s=60,
            merge_vad=True,
        )
        return self._format_text(result[0]["text"])


# ============================================================
# ListenNode — ROS2 语音识别节点
# ============================================================

class ListenNode(Node):
    """语音识别 ROS2 节点：VAD 实时检测 + ASR 识别 + 发布结果"""

    def __init__(self):
        super().__init__("listen_node")

        # ── 声明参数 ──
        self.declare_parameter("models_dir", _DEFAULT_MODELS_DIR)
        self.declare_parameter("sample_rate", _DEFAULT_SAMPLE_RATE)
        self.declare_parameter("chunk", _DEFAULT_CHUNK)
        self.declare_parameter("min_speech_duration", _DEFAULT_MIN_SPEECH_MS)
        self.declare_parameter("max_silence_duration", _DEFAULT_MAX_SILENCE_MS)
        self.declare_parameter("vad_threshold", _DEFAULT_VAD_THRESHOLD)

        # ── 读取参数 ──
        models_dir = self.get_parameter("models_dir").value
        asr_model_path = os.path.join(models_dir, "SenseVoiceSmall")
        fsmn_vad_path = os.path.join(models_dir, "speech_fsmn_vad_zh-cn-16k-common-pytorch")

        self.sample_rate = self.get_parameter("sample_rate").value
        self.chunk = self.get_parameter("chunk").value
        self.min_speech_duration = self.get_parameter("min_speech_duration").value
        self.max_silence_duration = self.get_parameter("max_silence_duration").value
        self.vad_threshold = self.get_parameter("vad_threshold").value

        # ── 发布者 ──
        self.text_pub = self.create_publisher(String, "/voice/text", 10)
        self.status_pub = self.create_publisher(String, "/voice/status", 10)

        # ── 加载模型 ──
        self.get_logger().info("加载 Silero VAD 模型...")
        self.silero_vad = load_silero_vad()
        self.get_logger().info("Silero VAD 加载完成")

        self.get_logger().info("加载 SenseVoiceSmall 模型...")
        self.asr_model = SenseVoiceModel(
            model_path=asr_model_path,
            vad_model_path=fsmn_vad_path,
        )
        self.get_logger().info("SenseVoiceSmall 加载完成")

        # ── 状态控制 ──
        self._listening_active = False
        self._lock = threading.Lock()
        self._listen_thread = None

        self.get_logger().info("语音节点初始化完成，等待启动指令...")
        self._publish_status("idle")

    # ── 公开 API ──

    def start_listening(self):
        """启动语音监听（后台线程）"""
        with self._lock:
            if self._listening_active:
                self.get_logger().warn("已经在监听中")
                return
            self._listening_active = True
            self._listen_thread = threading.Thread(
                target=self._listen_loop, daemon=True
            )
            self._listen_thread.start()
            self.get_logger().info("语音监听已启动")
            self._publish_status("idle")

    def stop_listening(self):
        """停止语音监听"""
        with self._lock:
            self._listening_active = False
        self.get_logger().info("语音监听已停止")
        self._publish_status("idle")

    # ── 内部逻辑 ──

    def _publish_status(self, status: str):
        msg = String()
        msg.data = status
        self.status_pub.publish(msg)

    def _listen_loop(self):
        """后台监听主循环：VAD 检测 + 录音 + ASR 识别"""

        # 状态变量
        silence_count = 0
        speech_count = 0
        audio_frames = []
        speech_detected = False
        pending_frames = []

        def _time_to_frames(ms):
            return int(ms * self.sample_rate / (1000 * self.chunk))

        def _int2float(audio_int16):
            audio = audio_int16.astype(np.float32)
            abs_max = np.abs(audio).max()
            if abs_max > 0:
                audio *= 1 / 32768
            return audio.squeeze()

        min_speech_frames = _time_to_frames(self.min_speech_duration)
        max_silence_frames = _time_to_frames(self.max_silence_duration)
        max_pending = min_speech_frames * 6

        try:
            with AudioRecorder(self.sample_rate, _DEFAULT_CHANNELS, self.chunk) as rec:
                self._publish_status("idle")
                while self._listening_active:
                    frame = rec.read_frame()

                    # ── VAD 推理 ──
                    audio_int16 = np.frombuffer(frame, dtype=np.int16)
                    audio_float32 = _int2float(audio_int16)

                    with torch.no_grad():
                        confidence = self.silero_vad(
                            torch.from_numpy(audio_float32), self.sample_rate
                        ).item()

                    # 维护缓冲区
                    pending_frames.append(frame)
                    if len(pending_frames) > max_pending:
                        pending_frames.pop(0)

                    if not speech_detected:
                        # ── 等待说话 ──
                        if confidence > self.vad_threshold:
                            speech_count += 1
                            if speech_count >= min_speech_frames:
                                speech_detected = True
                                silence_count = 0
                                audio_frames.extend(pending_frames.copy())
                                self.get_logger().info("检测到语音开始")
                                self._publish_status("speaking")
                        else:
                            speech_count = 0
                    else:
                        # ── 正在录音 ──
                        audio_frames.append(frame)

                        if confidence < self.vad_threshold:
                            silence_count += 1
                            if silence_count >= max_silence_frames:
                                # 说话结束 → 识别
                                speech_detected = False
                                self._publish_status("recognizing")
                                self.get_logger().info("检测到语音结束，开始识别...")

                                audio_data = b"".join(audio_frames)
                                audio_frames = []
                                speech_count = 0

                                # 直接传 numpy 数组，不落盘
                                audio_np = np.frombuffer(audio_data, dtype=np.int16)
                                text = self.asr_model.inference(
                                    (self.sample_rate, audio_np), "zh"
                                )
                                if text:
                                    self.get_logger().info(f"识别结果: {text}")
                                    msg = String()
                                    msg.data = text
                                    self.text_pub.publish(msg)

                                self._publish_status("idle")
                        else:
                            silence_count = 0

        except Exception as e:
            self.get_logger().error(f"监听循环异常: {e}")
            self._listening_active = False
            self._publish_status("idle")


# ============================================================
# 入口
# ============================================================

def main():
    rclpy.init()
    node = ListenNode()
    node.start_listening()

    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.stop_listening()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
