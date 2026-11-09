//! Developer-only reference. Never linked into production or built by PR CI.
use resvg::{tiny_skia, usvg};
use std::{env, fs, hint::black_box, process, time::Instant};

fn checksum(pixels: &[u8]) -> u64 {
    pixels.iter().fold(14695981039346656037u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(1099511628211)
    })
}

fn parse(data: &[u8]) -> Result<usvg::Tree, String> {
    // usvg produces a render-ready retained tree, including XML/style/geometry.
    // There is no distinct resvg recording pass in this pinned API.
    usvg::Tree::from_data(black_box(data), &usvg::Options::default()).map_err(|e| e.to_string())
}

fn render(tree: &usvg::Tree) -> Result<tiny_skia::Pixmap, String> {
    let size = tree.size().to_int_size();
    if u64::from(size.width()) * u64::from(size.height()) > 16_000_000 {
        return Err("image exceeds shared 16M pixel limit".into());
    }
    // Allocation and zeroing are measured, matching renderDisplayList in Silk.
    let mut pixmap = tiny_skia::Pixmap::new(size.width(), size.height()).ok_or("pixmap allocation failed")?;
    resvg::render(black_box(tree), tiny_skia::Transform::identity(), &mut pixmap.as_mut());
    Ok(pixmap)
}

fn end_to_end(data: &[u8]) -> Result<tiny_skia::Pixmap, String> {
    let tree = parse(data)?;
    render(&tree)
}

fn run() -> Result<(), String> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.as_slice() == ["--version"] {
        println!("svg-reference-bench protocol 1; resvg/usvg 91455ee06d08ac2bfeab2b035ed2cfbfd0a68614; fresh pixmap per render");
        return Ok(());
    }
    if args.len() != 4 || !["parse", "render", "end-to-end"].contains(&args[0].as_str()) {
        return Err("usage: svg-reference-bench parse|render|end-to-end FILE ITERATIONS WARMUP".into());
    }
    let iterations = args[2].parse::<u32>().map_err(|_| "invalid iterations")?;
    let warmup = args[3].parse::<u32>().map_err(|_| "invalid warmup")?;
    if !(1..=100_000).contains(&iterations) || warmup > 10_000 {
        return Err("iterations must be 1..100000 and warmup 0..10000".into());
    }
    let data = fs::read(&args[1]).map_err(|e| e.to_string())?;
    let retained = parse(&data)?;
    let mut elapsed_ns = 0u128;
    let mut hash = 0u64;
    let mut consumed = 0u64;
    let mut width = 0;
    let mut height = 0;
    for frame in 0..warmup + iterations {
        let start = Instant::now();
        let (image, elapsed) = match args[0].as_str() {
            "parse" => {
                let tree = parse(&data)?;
                let elapsed = start.elapsed();
                // Render every retained result outside timing, like Silk parse+record.
                (render(&tree)?, elapsed)
            }
            "render" => {
                let image = render(&retained)?;
                (image, start.elapsed())
            }
            _ => {
                let image = end_to_end(&data)?;
                (image, start.elapsed())
            }
        };
        let value = checksum(black_box(image.data()));
        consumed = consumed.wrapping_add(value);
        if frame >= warmup {
            elapsed_ns += elapsed.as_nanos();
            hash = value;
            width = image.width();
            height = image.height();
        }
        // Image destruction and the complete pixel checksum are outside timing.
    }
    println!("{{\"protocol\":1,\"iterations\":{iterations},\"warmup\":{warmup},\"elapsed_ns\":{elapsed_ns},\"checksum\":\"{hash}\",\"consumed\":\"{consumed}\",\"width\":{width},\"height\":{height}}}");
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("svg-reference-bench: {error}");
        process::exit(1);
    }
}
