"""
Builds tests/data/synthetic.json: a made-up but realistic Stacks library for the local-model test.

Why synthetic: the real export has 5 items in 4 folders, too few to measure anything. This set has
17 two-level folders with 8 items each, written in the style of the real data (robotics, ML, open
models) plus unrelated areas. Some folders deliberately overlap (Robotics › Papers vs › Robot
Learning, Cooking › Japanese Food vs Travel › Japan) so the test is not too easy.

It also lists "join" cases: a new paste that continues a saved course (should join) or that is a
different course on a similar subject (should not join).

Run: python3 tests/make_synthetic.py
"""
import json
from pathlib import Path

# folder path -> items as (title, notes). Items marked with * are courses used by the join test;
# they are saved most recently, so they are among the "latest 5" the app would show the AI.
FOLDERS = {
    "Robotics › Papers": [
        ("RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control", "Google DeepMind paper on co-fine-tuning vision-language models to output robot actions."),
        ("OpenVLA: An Open-Source Vision-Language-Action Model", "7B VLA trained on Open X-Embodiment; outperforms RT-2-X."),
        ("Diffusion Policy: Visuomotor Policy Learning via Action Diffusion", "Represents robot policies as conditional denoising diffusion."),
        ("π0: A Vision-Language-Action Flow Model for General Robot Control", "Physical Intelligence's flow matching VLA."),
        ("Dex-Net 2.0: Deep Learning to Plan Robust Grasps", "Synthetic point clouds and a grasp quality CNN."),
        ("Open X-Embodiment: Robotic Learning Datasets and RT-X Models", "Dataset pooled from 22 robots across 21 institutions."),
        ("Observing and Controlling Features in Vision-Language-Action Models", "Steering VLA internal representations at inference time without fine-tuning."),
        ("ALOHA: Learning Fine-Grained Bimanual Manipulation with Low-Cost Hardware", "ACT, action chunking with transformers, and a teleoperation setup."),
    ],
    "Robotics › Robot Learning": [
        ("Imitation learning explained: behavior cloning vs DAgger", "Blog post with examples."),
        ("Sim-to-real transfer: domain randomization tutorial", "How to train in simulation and deploy on real robots."),
        ("Reinforcement learning for legged locomotion", "Talk: how quadrupeds learn to walk with PPO in Isaac Gym."),
        ("Teleoperation data collection best practices", "Tips for collecting demonstrations for policy learning."),
        ("*Berkeley CS285 Deep Reinforcement Learning — Lecture 1", "Sergey Levine's course introduction."),
        ("*Russ Tedrake: Underactuated Robotics — Lecture 1", "MIT course on nonlinear dynamics and control."),
        ("*Hugging Face Robotics Course — Unit 1: Introduction to LeRobot", "Free course; setting up LeRobot and its datasets."),
        ("*Vizuara: Modern Robot Learning from Scratch — Lectures 3–4", "Lecture 3 - Deep Generative Modeling | Variational AutoEncoders. Lecture 4 - The Transformer Architecture for Robotics."),
    ],
    "Robotics › Hardware": [
        ("Choosing servo motors for a robot arm", "Torque, gearboxes and back-drivability explained."),
        ("Building a low-cost 6-DoF arm with 3D printed parts", "Bill of materials under $300, STL files included."),
        ("SO-100 arm assembly guide", "Assembling the open-source SO-100 arm with Feetech servos."),
        ("Soft robotic grippers: design and fabrication", "Silicone casting for pneumatic fingers."),
        ("Brushless motor control with FOC explained", "Field-oriented control on a cheap driver board."),
        ("Intel RealSense vs ZED depth cameras for robots", "Comparison of depth sensors."),
        ("Harmonic drives vs cycloidal reducers", "Which gearbox for robot joints."),
        ("Wiring and power distribution for mobile robots", "Batteries, fuses and voltage regulators."),
    ],
    "Robotics › ROS & Simulation": [
        ("ROS 2 Humble tutorial: publishers and subscribers", "Writing your first nodes in Python."),
        ("MuJoCo getting started", "Physics simulation for robotics research."),
        ("NVIDIA Isaac Sim: importing a URDF", "Setting up a robot in Isaac Sim."),
        ("Gazebo vs Isaac Sim vs MuJoCo", "Which simulator should you use?"),
        ("MoveIt 2 motion planning basics", "Planning arm trajectories in ROS 2."),
        ("Nav2 navigation stack walkthrough", "SLAM and path planning for mobile robots."),
        ("Writing URDF and Xacro files", "Describing robot kinematics."),
        ("ros2_control hardware interfaces explained", ""),
    ],
    "Machine Learning › LLMs": [
        ("LoRA: Low-Rank Adaptation of Large Language Models", "Parameter-efficient fine-tuning."),
        ("Prompt engineering guide", "Few-shot, chain of thought and structured output."),
        ("How RLHF works", "Reward models and PPO for aligning language models."),
        ("Retrieval-augmented generation from scratch", "Building a RAG pipeline with embeddings and a vector store."),
        ("Speculative decoding explained", "Faster LLM inference with a draft model."),
        ("Scaling laws for neural language models", "Kaplan et al."),
        ("KV cache and paged attention in vLLM", ""),
        ("DPO: Direct Preference Optimization", "Aligning LLMs without a reward model."),
    ],
    "Machine Learning › Computer Vision": [
        ("YOLO object detection explained", ""),
        ("Vision Transformers (ViT): An Image is Worth 16x16 Words", "Transformers applied to image patches."),
        ("Segment Anything Model (SAM) paper", "Promptable segmentation foundation model."),
        ("CLIP: Learning Transferable Visual Models From Natural Language Supervision", ""),
        ("Data augmentation for image classification", "Mixup, cutmix, random erasing."),
        ("Depth estimation with monocular cameras", "Depth Anything and MiDaS."),
        ("ResNet: Deep Residual Learning for Image Recognition", ""),
        ("*Stanford CS231n: Deep Learning for Computer Vision — Lectures 1–2", "Image classification, kNN and linear classifiers."),
    ],
    "Machine Learning › Courses": [
        ("Andrew Ng Machine Learning Specialization — Course 1", "Supervised learning, regression and classification."),
        ("fast.ai Practical Deep Learning for Coders — Lesson 1", ""),
        ("Dive into Deep Learning (d2l.ai)", "Interactive deep learning book with code."),
        ("Full Stack Deep Learning — course page", ""),
        ("Stanford CS229 Machine Learning — lecture notes", ""),
        ("Google Machine Learning Crash Course", ""),
        ("*MIT 6.S191 Introduction to Deep Learning — Lecture 1", "Foundations of deep learning, 2026 edition."),
        ("*Andrej Karpathy: Neural Networks Zero to Hero — micrograd", "Building backpropagation from scratch."),
    ],
    "Machine Learning › Math": [
        ("3Blue1Brown: Essence of Linear Algebra", "Visual intuition for vectors, matrices and eigenvalues."),
        ("Probability for machine learning — cheat sheet", ""),
        ("Matrix calculus for deep learning", "Derivatives of vectors and matrices."),
        ("Information theory basics: entropy and KL divergence", ""),
        ("Convex optimization (Boyd) lecture videos", ""),
        ("Bayes' theorem explained visually", ""),
        ("Gradient descent and its variants: SGD, momentum, Adam", ""),
        ("Singular value decomposition intuition", ""),
    ],
    "Open Models › Releases": [
        ("Llama 4 release notes", "Meta's new open-weight models, context length and benchmarks."),
        ("Qwen3 technical report", "Alibaba's open model family from 0.6B to 235B."),
        ("Mistral Small 3.1 announcement", "24B open model under Apache 2.0."),
        ("OLMo 2: fully open language models", "AI2 releases weights, data and training code."),
        ("Gemma 3 open models from Google", ""),
        ("DeepSeek-V3 technical report", "Mixture-of-experts open model."),
        ("SmolLM2: small language models by Hugging Face", ""),
        ("Phi-4 model card", ""),
    ],
    "Open Models › Ecosystem": [
        ("Open models lecture: ecosystem, debates, and future access", "Covering the pieces that build the open ecosystem: distillation, risks and access."),
        ("An Introduction to Open Source AI", "Course on open source models."),
        ("What counts as open source AI? The OSI definition", ""),
        ("Open-weight model licenses compared", "Llama license vs Apache 2.0 vs MIT."),
        ("The state of open models — Interconnects", "Nathan Lambert's yearly review."),
        ("Policy debate: should frontier model weights be released?", ""),
        ("Hugging Face Open LLM Leaderboard explained", ""),
        ("Distillation and the open model ecosystem", ""),
    ],
    "Programming › Rust": [
        ("The Rust Book: ownership chapter", ""),
        ("Async Rust with Tokio tutorial", ""),
        ("Error handling in Rust: anyhow vs thiserror", ""),
        ("Writing a CLI in Rust with clap", ""),
        ("Rust lifetimes explained", ""),
        ("Zero-cost abstractions in Rust", ""),
        ("Rust for Python developers", ""),
        ("*Rustlings exercises walkthrough — part 1", "Variables, functions and if."),
    ],
    "Programming › TypeScript": [
        ("TypeScript generics deep dive", ""),
        ("Type narrowing and discriminated unions", ""),
        ("Zod schema validation in TypeScript", ""),
        ("React 19 with TypeScript: typing hooks", ""),
        ("tsconfig options explained", ""),
        ("Effect-TS introduction", ""),
        ("Vite + TypeScript project setup", ""),
        ("Type-level programming with template literal types", ""),
    ],
    "Cooking › Pizza": [
        ("Neapolitan pizza at home in a regular oven", "Steel plate and broiler method."),
        ("New York style pizza dough recipe", ""),
        ("Detroit-style pizza in a cast iron pan", ""),
        ("Best flour for pizza: 00 vs bread flour", ""),
        ("Pizza sauce: San Marzano tomatoes, no cooking", ""),
        ("Ooni Koda 16 review", "Outdoor gas pizza oven."),
        ("Cold fermentation for pizza dough", "48–72 hour fridge proof."),
        ("*Sourdough pizza series ep. 1: making the starter", "Feeding schedule and hydration."),
    ],
    "Cooking › Japanese Food": [
        ("How to make tonkotsu ramen broth", ""),
        ("Homemade sushi rice", ""),
        ("Miso soup with dashi from scratch", ""),
        ("Gyoza folding technique", ""),
        ("Japanese curry roux from scratch", ""),
        ("Okonomiyaki recipe", ""),
        ("Teriyaki chicken, the authentic way", ""),
        ("Onigiri filling ideas", ""),
    ],
    "Finance › Investing": [
        ("Index funds vs ETFs explained", ""),
        ("How to build a three-fund portfolio", ""),
        ("Dollar-cost averaging: does it work?", ""),
        ("Understanding P/E ratios", ""),
        ("Roth IRA vs traditional IRA", ""),
        ("Bond ladders for beginners", ""),
        ("Warren Buffett's shareholder letters summary", ""),
        ("Rebalancing your portfolio once a year", ""),
    ],
    "Fitness › Running": [
        ("Zone 2 training for runners", ""),
        ("How to choose running shoes", ""),
        ("Marathon fueling strategy", ""),
        ("Running form drills", ""),
        ("Interval training: 400m repeats", ""),
        ("Preventing shin splints", ""),
        ("Strength training for runners", ""),
        ("*Couch to 5K: week 1 plan", "Run/walk intervals for beginners."),
    ],
    "Travel › Japan": [
        ("Two weeks in Japan itinerary", ""),
        ("JR Pass: is it still worth it?", ""),
        ("Best ramen shops in Tokyo", ""),
        ("Kyoto temples guide", ""),
        ("Hiking the Kumano Kodo", ""),
        ("Japan travel tips for first-timers", ""),
        ("Hakone onsen ryokan recommendations", ""),
        ("Osaka street food guide", ""),
    ],
}

# New pastes. "join" is the title of the saved item it continues, or None when it must NOT join.
JOINS = [
    ("CS231n Lecture 5: Convolutional Neural Networks", "Stanford CS231n, spring lectures.", "Stanford CS231n: Deep Learning for Computer Vision — Lectures 1–2"),
    ("Lecture 5 - Diffusion Policy | Modern Robot Learning from Scratch", "Vizuara robotics from scratch.", "Vizuara: Modern Robot Learning from Scratch — Lectures 3–4"),
    ("MIT 6.S191 (2026) Lecture 2: Recurrent Neural Networks and Transformers", "", "MIT 6.S191 Introduction to Deep Learning — Lecture 1"),
    ("Hugging Face Robotics Course — Unit 2: Imitation learning with LeRobot", "", "Hugging Face Robotics Course — Unit 1: Introduction to LeRobot"),
    ("Rustlings walkthrough part 2: ownership and borrowing", "", "Rustlings exercises walkthrough — part 1"),
    ("Let's build GPT: from scratch, in code, spelled out", "Andrej Karpathy, Neural Networks: Zero to Hero.", "Andrej Karpathy: Neural Networks Zero to Hero — micrograd"),
    ("Sourdough pizza series ep. 2: shaping and baking", "", "Sourdough pizza series ep. 1: making the starter"),
    ("Couch to 5K: week 4 guide", "Longer runs, shorter walks.", "Couch to 5K: week 1 plan"),
    ("Underactuated Robotics — Lecture 2: The Simple Pendulum", "Russ Tedrake, MIT.", "Russ Tedrake: Underactuated Robotics — Lecture 1"),
    ("CS285 Deep RL Lecture 5: Policy Gradients", "Sergey Levine.", "Berkeley CS285 Deep Reinforcement Learning — Lecture 1"),
    # Different course or series on a similar subject: must not join.
    ("Stanford CS234 Reinforcement Learning — Lecture 3", "Emma Brunskill.", None),
    ("Stanford CS224n NLP with Deep Learning — Lecture 4: Dependency Parsing", "", None),
    ("DeepLearning.AI: Neural Networks and Deep Learning — Week 2", "Coursera course.", None),
    ("Neapolitan pizza dough masterclass", "A 70% hydration dough by a pizzaiolo from Naples.", None),
    ("Rust by Example: traits chapter", "", None),
    ("Half marathon training plan — week 1", "", None),
    ("Stanford CS223A Introduction to Robotics — Lecture 2", "Oussama Khatib.", None),
    ("Coursera Modern Robotics Specialization — Course 1: Foundations of Robot Motion", "Kevin Lynch, Northwestern.", None),
]


def main():
    items = []
    t = 0
    for path, rows in FOLDERS.items():
        # Plain items first, courses last, so courses are the most recent.
        ordered = [r for r in rows if not r[0].startswith("*")] + [r for r in rows if r[0].startswith("*")]
        for title, notes in ordered:
            t += 1
            items.append({"id": f"s{t}", "folder": path, "title": title.lstrip("*"), "notes": notes, "addedAt": t, "course": title.startswith("*")})
    titles = {i["title"] for i in items}
    for _, _, j in JOINS:
        assert j is None or j in titles, j
    out = {
        "note": "Synthetic test library written for the local-model assessment. Not real user data.",
        "folders": list(FOLDERS),
        "items": items,
        "joins": [{"title": a, "notes": b, "join": c} for a, b, c in JOINS],
    }
    dest = Path(__file__).parent / "data" / "synthetic.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"{len(items)} items in {len(FOLDERS)} folders, {len(JOINS)} join cases -> {dest}")


if __name__ == "__main__":
    main()
